import { json, type RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authGuard } from '$lib/auth/middleware';
import { db } from '$lib/db';
import { lists, items, listMembers } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { emitToListMembers } from '$lib/server/userEvents';
import { now } from '$lib/auth';
import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';

function getListAccess(listId: string, userId: string): { permission: 'owner' | 'write' | 'read' | null } {
	const list = db.select().from(lists).where(eq(lists.id, listId)).get();
	if (!list) return { permission: null };
	if (list.ownerId === userId) return { permission: 'owner' };
	const member = db.select().from(listMembers).where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId), eq(listMembers.status, 'accepted'))).get();
	return { permission: member ? (member.permission === 'write' ? 'write' : 'read') : null };
}

function isLocale(value: unknown): value is Locale {
	return value === 'de' || value === 'en';
}

function requestLocale(event: RequestEvent, userSettings: string | null): Locale {
	try {
		const lang = userSettings ? JSON.parse(userSettings)?.lang : null;
		if (isLocale(lang)) return lang;
	} catch {
		// Ignore malformed persisted settings and fall back to request hints.
	}
	const cookieLocale = event.cookies.get('PARAGLIDE_LOCALE');
	if (isLocale(cookieLocale)) return cookieLocale;
	return event.request.headers.get('accept-language')?.toLowerCase().startsWith('en') ? 'en' : 'de';
}

export const POST: RequestHandler = async (event) => {
	const { error, user } = authGuard(event);
	if (error) return error;
	const locale = requestLocale(event, user!.settings);

	const { permission } = getListAccess(event.params.id, user!.id);
	if (permission === null) return json({ error: m.api_error_not_found({}, { locale }) }, { status: 404 });
	if (permission === 'read') return json({ error: m.api_error_no_write_permission({}, { locale }) }, { status: 403 });

	const body = await event.request.json();
	const itemIds = Array.isArray(body.itemIds)
		? body.itemIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
		: [];
	if (itemIds.length === 0) return json({ error: m.api_error_reorder_no_items({}, { locale }) }, { status: 400 });
	if (new Set(itemIds).size !== itemIds.length) return json({ error: m.api_error_reorder_duplicate_items({}, { locale }) }, { status: 400 });

	const existing = db
		.select({ id: items.id })
		.from(items)
		.where(and(eq(items.listId, event.params.id), eq(items.isChecked, false), inArray(items.id, itemIds)))
		.all();
	if (existing.length !== itemIds.length) return json({ error: m.api_error_reorder_invalid_items({}, { locale }) }, { status: 400 });

	const ts = now();
	db.transaction((tx) => {
		itemIds.forEach((id: string, index: number) => {
			tx.update(items)
				.set({ sortOrder: (index + 1) * 1000, updatedAt: ts })
				.where(eq(items.id, id))
				.run();
		});
		tx.update(lists).set({ updatedAt: ts }).where(eq(lists.id, event.params.id)).run();
	});

	emitToListMembers(event.params.id, { type: 'items_reordered', listId: event.params.id, itemIds, updatedAt: ts, byUserId: user!.id });
	return json({ ok: true, itemIds, updatedAt: ts });
};

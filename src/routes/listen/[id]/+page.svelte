<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { on } from '$lib/sseStore.svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import HamburgerMenu from '$lib/components/HamburgerMenu.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import ItemTile from '$lib/components/ItemTile.svelte';
	import ItemRow from '$lib/components/ItemRow.svelte';
	import ListInteractionModeBar from '$lib/components/ListInteractionModeBar.svelte';
	import type { ListInteractionMode } from '$lib/listInteractionMode';
	import CheckedDrawer from '$lib/components/CheckedDrawer.svelte';
	import AddItemModal from '$lib/components/AddItemModal.svelte';
	import AddItemBar from '$lib/components/AddItemBar.svelte';
	import { execute, generateClientId, cacheItemsData, getOfflineItems, getOfflineListName, updateOfflineItem, deleteOfflineItem } from '$lib/sync/manager';
	import { t, list_items_open, list_search_results_subtitle } from '$lib/i18n.svelte';
	import { getCategoryKey } from '$lib/categories';
	import { userSettings } from '$lib/userSettings.svelte';

	const LISTVIEW_HINT_KEY = 'groly_listview_hint_dismissed';
	const LOCATION_HINT_KEY = 'groly_location_hint_dismissed';
	const LIST_INTERACTION_MODE_KEY = 'groly_list_interaction_mode';
	let showListViewHint = $state(false);
	let showLocationHint = $state(false);

	let { data } = $props();

	type Item = { id: string; listId: string; name: string; quantityInfo: string | null; isChecked: boolean; checkedAt: number | null; categoryOverride: string | null; sortOrder: number; createdByUsername: string | null; createdAt: number; updatedAt: number };

	type Favorite = { name: string; quantityInfo: string | null; categoryOverride: string | null };

	let listName = $state('');
	let items = $state<Item[]>([]);
	let favorites = $state<Favorite[]>([]);
	const favoriteNames = $derived(new Set(favorites.map(f => f.name.toLowerCase())));
	const activeItemNames = $derived(new Set(items.map(i => i.name.toLowerCase())));
	let menuOpen = $state(false);
	let addModalOpen = $state(false);
	let loading = $state(true);
	let editItem = $state<Item | null>(null);
	let suggestions = $state<string[]>([]);
	let userPermission = $state<'owner' | 'write' | 'read'>('write');
	let searchQuery = $state('');
	let searchOpen = $state(false);
	let keyboardOpen = $state(false);
	let scrollContainer = $state<HTMLDivElement | null>(null);
	let autoScannerOnOpen = $state(false);
	let autoFavoritesOnOpen = $state(false);
	let itemsLoadVersion = 0;
	let listInteractionMode = $state<ListInteractionMode>('normal');
	let reorderDragId = $state<string | null>(null);
	let flashingItemId = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | null = null;

	const listId = $derived($page.params.id);
	const showListModeBar = $derived(userPermission !== 'read');
	const effectiveListInteractionMode = $derived(
		userPermission === 'read' ? 'normal' : listInteractionMode
	);
	const topBaseRem = '5.25rem';
	const hintTopBaseRem = '5.5rem';
	const modeBarRem = '2.875rem';
	const panelRem = '3.5rem';
	const manualOrderActive = $derived(items.some(i => !i.isChecked && (i.sortOrder ?? 0) > 0));
	const openItems = $derived.by(() => {
		const unchecked = items.filter(i => !i.isChecked);
		if (manualOrderActive) {
			return [...unchecked].sort((a, b) => {
				const ao = (a.sortOrder ?? 0) > 0 ? a.sortOrder : Number.MAX_SAFE_INTEGER;
				const bo = (b.sortOrder ?? 0) > 0 ? b.sortOrder : Number.MAX_SAFE_INTEGER;
				return ao - bo || a.createdAt - b.createdAt;
			});
		}
		const listSettings = listId ? userSettings.getListCategorySettings(listId) : null;
		const sortEnabled = listSettings !== null ? listSettings.enabled : userSettings.categorySortEnabled;
		if (!sortEnabled) return unchecked;
		const order = listSettings !== null ? listSettings.order : userSettings.categoryOrder;
		const orderIndex = new Map(order.map((key, index) => [key, index]));
		return [...unchecked].sort((a, b) => {
			const ai = orderIndex.get(getCategoryKey(a.name, a.categoryOverride)) ?? -1;
			const bi = orderIndex.get(getCategoryKey(b.name, b.categoryOverride)) ?? -1;
			// Higher index = top of grid (earlier in array), lower index = bottom (later in array)
			return bi - ai;
		});
	});
	const checkedItems = $derived.by(() => {
		const sorted = items.filter(i => i.isChecked).sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
		return userSettings.showAllCheckedItems ? sorted : sorted.slice(0, 16);
	});
	const openCount = $derived(openItems.length);
	const showSearch = $derived(openItems.length >= 5 || items.some(i => i.isChecked));
	const displayItems = $derived(
		searchQuery.trim()
			? openItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
			: openItems
	);
	const displayCheckedItems = $derived(
		searchQuery.trim()
			? items.filter(i => i.isChecked).sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0))
			       .filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
			: checkedItems
	);
	// Empty prefix slots so the grid fills bottom-up (empty slots at top-left)
	const gridPrefix = $derived(displayItems.length % 3 === 0 ? 0 : 3 - (displayItems.length % 3));
	const totalSearchResults = $derived(displayItems.length + (searchQuery.trim() ? displayCheckedItems.length : 0));
	const headerSubtitle = $derived(
		searchQuery.trim() ? list_search_results_subtitle(totalSearchResults) : list_items_open(openCount)
	);
	const modeBarOffset = $derived(showListModeBar ? ` + ${modeBarRem}` : '');
	const searchPanelOffset = $derived(searchOpen ? ` + ${panelRem}` : '');
	const listHintPanelOffset = $derived(showListViewHint ? ` + ${panelRem}` : '');
	const locationHintPanelOffset = $derived(showLocationHint ? ` + ${panelRem}` : '');
	const searchTop = $derived(`calc(env(safe-area-inset-top) + ${topBaseRem}${modeBarOffset})`);
	const listHintTop = $derived(`calc(env(safe-area-inset-top) + ${hintTopBaseRem}${modeBarOffset})`);
	const locationHintTop = $derived(
		`calc(env(safe-area-inset-top) + ${hintTopBaseRem}${modeBarOffset}${listHintPanelOffset})`
	);
	const contentTop = $derived(
		`calc(env(safe-area-inset-top) + ${topBaseRem}${modeBarOffset}${searchPanelOffset}${listHintPanelOffset}${locationHintPanelOffset})`
	);

	function focusInlineEditorById(itemId: string) {
		document.querySelector<HTMLElement>(`[data-item-editor="${CSS.escape(itemId)}"]`)?.focus();
	}

	function canonicalItemName(name: string): string {
		return name.trim().replace(/\s+/g, ' ').toLowerCase();
	}

	function findDuplicateItem(name: string, exceptId: string | null = null): Item | null {
		const key = canonicalItemName(name);
		if (!key) return null;
		return items.find(item => item.id !== exceptId && canonicalItemName(item.name) === key) ?? null;
	}

	function openItemsWithRestoredDuplicate(anchor: Item | null, duplicate: Item): Item[] {
		const next = openItems.filter(item => item.id !== duplicate.id);
		if (!anchor) return [...next, { ...duplicate, isChecked: false, checkedAt: null }];
		const anchorIndex = next.findIndex(item => item.id === anchor.id);
		const restored = { ...duplicate, isChecked: false, checkedAt: null };
		if (anchorIndex < 0) return [...next, restored];
		if (!anchor.name.trim()) {
			return [...next.slice(0, anchorIndex), restored, ...next.slice(anchorIndex + 1)];
		}
		return [...next.slice(0, anchorIndex + 1), restored, ...next.slice(anchorIndex + 1)];
	}

	async function flashExistingItem(item: Item, { focusEditor = false }: { focusEditor?: boolean } = {}) {
		closeSearch();
		flashingItemId = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-list-item-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({
			block: 'center',
			behavior: 'smooth'
		});
		if (focusEditor) {
			await tick();
			focusInlineEditorById(item.id);
		}
		flashingItemId = item.id;
		if (flashTimer) clearTimeout(flashTimer);
		flashTimer = setTimeout(() => {
			flashingItemId = null;
			flashTimer = null;
		}, 2500);
	}

	async function restoreCheckedDuplicateAt(anchor: Item | null, duplicate: Item, { focusEditor = true }: { focusEditor?: boolean } = {}) {
		const nextOpenItems = openItemsWithRestoredDuplicate(anchor, duplicate);
		const nextOrder = new Map(nextOpenItems.map((item, index) => [item.id, (index + 1) * 1000]));
		const duplicateSortOrder = nextOrder.get(duplicate.id) ?? sortOrderForNewItem(anchor?.id);
		const clientUpdatedAt = duplicate.updatedAt;
		const ts = Math.floor(Date.now() / 1000);
		const removeAnchor = !!anchor && !anchor.name.trim();

		await execute(
			() =>
				fetch(`/api/items/${duplicate.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ isChecked: false, sortOrder: duplicateSortOrder, clientUpdatedAt })
				}).then(r => {
					if (!r.ok) throw new Error();
				}),
			{
				type: 'update_item',
				payload: { id: duplicate.id, isChecked: false, sortOrder: duplicateSortOrder, clientUpdatedAt },
				createdAt: Date.now()
			},
			() => {
				items = items
					.map(item => {
						const sortOrder = nextOrder.get(item.id);
						if (item.id === duplicate.id) {
							return { ...item, isChecked: false, checkedAt: null, sortOrder: duplicateSortOrder, updatedAt: ts };
						}
						return sortOrder ? { ...item, sortOrder, updatedAt: ts } : item;
					})
					.filter(item => !removeAnchor || item.id !== anchor.id);
				void updateOfflineItem(duplicate.id, {
					isChecked: false,
					checkedAt: null,
					sortOrder: duplicateSortOrder,
					updatedAt: ts
				});
				void cacheItemsData(items);
			}
		);

		if (removeAnchor) await deleteItem(anchor.id);
		await persistOpenItemOrder(nextOpenItems);
		await tick();
		await flashExistingItem({ ...duplicate, isChecked: false, checkedAt: null, sortOrder: duplicateSortOrder }, { focusEditor });
	}

	async function loadItems() {
		const targetListId = listId ?? '';
		const requestVersion = ++itemsLoadVersion;

		// Gecachte Daten sofort anzeigen, während der Netzwerk-Fetch läuft (stale-while-revalidate)
		if (items.length === 0) {
			const [cachedName, cachedItems] = await Promise.all([
				getOfflineListName(targetListId),
				getOfflineItems(targetListId)
			]);
			if (requestVersion !== itemsLoadVersion || targetListId !== (listId ?? '')) return;
			if (cachedItems.length > 0) {
				listName = cachedName || listName;
				items = cachedItems.map(item => ({
					...item,
					sortOrder: item.sortOrder ?? 0,
					createdAt: item.createdAt ?? item.updatedAt,
					createdByUsername: null
				}));
				loading = false;
				await tick();
				scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight });
			}
		}

		try {
			const [listRes, itemsRes, suggestRes, favsRes] = await Promise.all([
				fetch(`/api/lists/${targetListId}`),
				fetch(`/api/lists/${targetListId}/items`),
				fetch('/api/suggestions'),
				fetch('/api/favorites')
			]);
			if (!listRes.ok || !itemsRes.ok) throw new Error();
			const listData = await listRes.json();
			if (requestVersion !== itemsLoadVersion || targetListId !== (listId ?? '')) return;
			listName = listData.name;
			userPermission = listData.userPermission ?? 'write';
			const newItems: Item[] = (await itemsRes.json()).map((item: Item) => ({
				...item,
				sortOrder: item.sortOrder ?? 0,
				createdAt: item.createdAt ?? item.updatedAt
			}));
			if (suggestRes.ok) suggestions = await suggestRes.json();
			if (favsRes.ok) favorites = await favsRes.json();
			// Cache als plain objects (vor State-Zuweisung)
			void cacheItemsData(newItems);
			items = newItems;
		} catch {
			if (requestVersion !== itemsLoadVersion || targetListId !== (listId ?? '')) return;
			if (items.length === 0) {
				listName = await getOfflineListName(targetListId);
				if (requestVersion !== itemsLoadVersion || targetListId !== (listId ?? '')) return;
				items = (await getOfflineItems(targetListId)).map(item => ({
					...item,
					sortOrder: item.sortOrder ?? 0,
					createdAt: item.createdAt ?? item.updatedAt,
					createdByUsername: null
				}));
			}
		}
		if (requestVersion !== itemsLoadVersion || targetListId !== (listId ?? '')) return;
		loading = false;
		await tick();
		scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight });
	}

	function setListInteractionMode(m: ListInteractionMode) {
		if (m === listInteractionMode) return;
		const active = document.activeElement;
		if (active instanceof HTMLElement && active.hasAttribute('data-inline-item-name')) {
			active.blur();
		}
		listInteractionMode = m;
		localStorage.setItem(LIST_INTERACTION_MODE_KEY, m);
	}

	async function saveItemInlineName(item: Item, newName: string): Promise<'saved' | 'duplicate' | 'restored' | 'unchanged'> {
		if (userPermission === 'read') return 'unchanged';
		const trimmed = newName.trim();
		if (!trimmed || trimmed === item.name) return 'unchanged';
		const duplicate = findDuplicateItem(trimmed, item.id);
		if (duplicate) {
			if (duplicate.isChecked) {
				await restoreCheckedDuplicateAt(item, duplicate);
				return 'restored';
			}
			await flashExistingItem(duplicate, { focusEditor: true });
			return 'duplicate';
		}
		const id = item.id;
		const clientUpdatedAt = item.updatedAt;
		await execute(
			() =>
				fetch(`/api/items/${id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: trimmed, clientUpdatedAt })
				}).then(r => {
					if (!r.ok) throw new Error();
				}),
			{ type: 'update_item', payload: { id, name: trimmed, clientUpdatedAt }, createdAt: Date.now() },
			() => {
				const ts = Math.floor(Date.now() / 1000);
				items = items.map(i => (i.id === id ? { ...i, name: trimmed, updatedAt: ts } : i));
				void updateOfflineItem(id, { name: trimmed, updatedAt: ts });
			}
		);
		return 'saved';
	}

	async function commitInlineName(item: Item, newName: string) {
		const result = await saveItemInlineName(item, newName);
		if (result === 'duplicate' && !item.name.trim()) {
			await handleInlineExitEmpty(item);
		}
	}

	async function pickInlineSuggestion(item: Item, name: string) {
		const result = await saveItemInlineName(item, name);
		if (result === 'duplicate' && !item.name.trim()) {
			await handleInlineExitEmpty(item);
			return;
		}
		if (result !== 'duplicate') {
			await tick();
			const editor = document.querySelector<HTMLElement>(`[data-item-editor="${CSS.escape(item.id)}"]`);
			if (editor) {
				editor.textContent = name;
				editor.focus();
			}
		}
	}

	async function navigateItemVertical(fromItem: Item, dir: -1 | 1) {
		const list = displayItems;
		const idx = list.findIndex(i => i.id === fromItem.id);
		if (idx < 0) return;
		const nextIdx = idx + dir;
		if (nextIdx < 0 || nextIdx >= list.length) return;
		const nextId = list[nextIdx].id;
		(document.activeElement as HTMLElement | null)?.blur();
		await tick();
		focusInlineEditorById(nextId);
	}

	async function toggleItem(item: Item) {
		if (userPermission === 'read') return;
		const newChecked = !item.isChecked;
		const newCheckedAt = newChecked ? Math.floor(Date.now() / 1000) : null;
		const clientUpdatedAt = item.updatedAt;
		await execute(
			() => fetch(`/api/items/${item.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isChecked: newChecked, clientUpdatedAt })
			}).then(r => { if (!r.ok) throw new Error(); }),
			{ type: 'update_item', payload: { id: item.id, isChecked: newChecked, clientUpdatedAt }, createdAt: Date.now() },
			() => {
				items = items.map(i => i.id === item.id ? { ...i, isChecked: newChecked, checkedAt: newCheckedAt } : i);
				void updateOfflineItem(item.id, { isChecked: newChecked, checkedAt: newCheckedAt, updatedAt: Math.floor(Date.now() / 1000) });
			}
		);
	}

	function categoryOverrideForNewRowAfter(afterItem: Item): string | null {
		const pk = getCategoryKey(afterItem.name, afterItem.categoryOverride);
		const dk = getCategoryKey('', null);
		return pk === dk ? null : pk;
	}

	async function inlineEnterNewBelow(fromItem: Item, typedName: string) {
		if (userPermission === 'read') return;
		const trimmed = typedName.trim();
		if (!trimmed) {
			await handleInlineExitEmpty(fromItem);
			return;
		}
		if (trimmed !== fromItem.name) {
			const result = await saveItemInlineName(fromItem, trimmed);
			if (result === 'duplicate') {
				if (!fromItem.name.trim()) await handleInlineExitEmpty(fromItem);
				return;
			}
			if (result === 'restored') return;
		}
		const basis = items.find(i => i.id === fromItem.id) ?? fromItem;
		const cat = categoryOverrideForNewRowAfter(basis);
		const newId = await addItem('', '', { afterItemId: basis.id, categoryOverride: cat });
		await tick();
		focusInlineEditorById(newId);
	}

	async function handleInlineExitEmpty(item: Item) {
		if (userPermission === 'read') return;
		await deleteItem(item.id);
	}

	function toggleItemFromView(item: Item) {
		void toggleItem(item);
	}

	function openItemEdit(item: Item) {
		if (userPermission === 'read') return;
		editItem = item;
		addModalOpen = true;
	}

	function orderOpenItems(nextOpenItems: Item[]) {
		const nextOrder = new Map(nextOpenItems.map((item, index) => [item.id, (index + 1) * 1000]));
		const ts = Math.floor(Date.now() / 1000);
		items = items.map(item =>
			nextOrder.has(item.id)
				? { ...item, sortOrder: nextOrder.get(item.id)!, updatedAt: ts }
				: item
		);
		void cacheItemsData(items);
	}

	async function persistOpenItemOrder(nextOpenItems: Item[]) {
		const itemIds = nextOpenItems.map(item => item.id);
		await execute(
			() =>
				fetch(`/api/lists/${listId}/items/reorder`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ itemIds })
				}).then(r => {
					if (!r.ok) throw new Error();
				}),
			{ type: 'reorder_items', payload: { listId: listId ?? '', itemIds }, createdAt: Date.now() },
			() => orderOpenItems(nextOpenItems)
		);
	}

	function reorderedOpenItems(item: Item, dir: -1 | 1): Item[] | null {
		const next = [...openItems];
		const index = next.findIndex(i => i.id === item.id);
		const target = index + dir;
		if (index < 0 || target < 0 || target >= next.length) return null;
		[next[index], next[target]] = [next[target], next[index]];
		return next;
	}

	function moveOpenItem(item: Item, dir: -1 | 1) {
		if (userPermission === 'read') return;
		const next = reorderedOpenItems(item, dir);
		if (!next) return;
		void persistOpenItemOrder(next);
	}

	function startReorderDrag(e: PointerEvent, item: Item) {
		if (userPermission === 'read') return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		reorderDragId = item.id;
		let lastY = e.clientY;
		let moved = false;

		const onMove = (ev: PointerEvent) => {
			const delta = ev.clientY - lastY;
			if (Math.abs(delta) < 34) return;
			const next = reorderedOpenItems(item, delta < 0 ? -1 : 1);
			if (next) {
				orderOpenItems(next);
				moved = true;
			}
			lastY = ev.clientY;
		};
		const onEnd = () => {
			if (moved) void persistOpenItemOrder(openItems);
			reorderDragId = null;
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
			document.removeEventListener('pointercancel', onEnd);
		};
		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onEnd);
		document.addEventListener('pointercancel', onEnd);
	}

	function sortOrderForNewItem(afterItemId?: string | null): number {
		const ordered = openItems;
		if (!ordered.some(item => (item.sortOrder ?? 0) > 0)) return 0;
		if (!afterItemId) return ((ordered.at(-1)?.sortOrder ?? 0) || ordered.length * 1000) + 1000;
		const index = ordered.findIndex(item => item.id === afterItemId);
		const prev = index >= 0 ? ordered[index] : ordered.at(-1);
		const next = index >= 0 ? ordered[index + 1] : null;
		const prevOrder = prev?.sortOrder ?? 0;
		const nextOrder = next?.sortOrder ?? 0;
		if (prevOrder > 0 && nextOrder > prevOrder + 1) return Math.floor((prevOrder + nextOrder) / 2);
		return (prevOrder || ordered.length * 1000) + 1000;
	}

	async function addItem(
		name: string,
		quantityInfo: string,
		opts?: { afterItemId?: string | null; categoryOverride?: string | null }
	): Promise<string> {
		const id = generateClientId();
		const trimmedName = name.trim();
		const trimmedQty = quantityInfo.trim() || null;
		const catOverride = opts?.categoryOverride ?? null;
		const duplicate = findDuplicateItem(trimmedName);
		if (duplicate) {
			if (duplicate.isChecked) {
				await restoreCheckedDuplicateAt(null, duplicate, { focusEditor: false });
				return duplicate.id;
			}
			await flashExistingItem(duplicate);
			return duplicate.id;
		}
		const sortOrder = sortOrderForNewItem(opts?.afterItemId);
		const optimisticItem: Item = {
			id,
			listId: listId ?? '',
			name: trimmedName,
			quantityInfo: trimmedQty,
			isChecked: false,
			checkedAt: null,
			categoryOverride: catOverride,
			sortOrder,
			createdByUsername: data.user?.username ?? null,
			createdAt: Math.floor(Date.now() / 1000),
			updatedAt: Math.floor(Date.now() / 1000)
		};
		let nextItems: Item[];
		if (opts?.afterItemId) {
			const ix = items.findIndex(i => i.id === opts.afterItemId);
			nextItems =
				ix < 0
					? [...items, optimisticItem]
					: [...items.slice(0, ix + 1), optimisticItem, ...items.slice(ix + 1)];
		} else {
			nextItems = [...items, optimisticItem];
		}
		await execute(
			() =>
				fetch(`/api/lists/${listId}/items`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id,
						name: trimmedName,
						quantityInfo,
						categoryOverride: catOverride,
						sortOrder
					})
				}).then(async r => {
					if (!r.ok) throw new Error();
					const created = await r.json();
					if (created?.duplicate && created.item) {
						const duplicateItem = normalizeItem(created.item as Item);
						items = items.filter(item => item.id !== id);
						void cacheItemsData(items);
						if (duplicateItem.isChecked) {
							await restoreCheckedDuplicateAt(null, duplicateItem, { focusEditor: false });
							return;
						}
						await flashExistingItem(duplicateItem);
					}
				}),
			{
				type: 'create_item',
				payload: {
					id,
					listId: listId ?? '',
					name: trimmedName,
					quantityInfo,
					categoryOverride: catOverride,
					sortOrder
				},
				createdAt: Date.now()
			},
			() => {
				items = nextItems;
				void cacheItemsData(items);
				if (trimmedName && !suggestions.includes(trimmedName)) {
					suggestions = [trimmedName, ...suggestions].slice(0, 30);
				}
			}
		);
		return id;
	}

	async function saveEditItem(name: string, quantityInfo: string, categoryOverride: string | null) {
		if (!editItem) return;
		const id = editItem.id;
		const duplicate = findDuplicateItem(name, id);
		if (duplicate) {
			addModalOpen = false;
			editItem = null;
			await flashExistingItem(duplicate);
			return;
		}
		const clientUpdatedAt = editItem.updatedAt;
		editItem = null;
		addModalOpen = false;
		await execute(
			() => fetch(`/api/items/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, quantityInfo, categoryOverride, clientUpdatedAt })
			}).then(r => { if (!r.ok) throw new Error(); }),
			{ type: 'update_item', payload: { id, name, quantityInfo, categoryOverride, clientUpdatedAt }, createdAt: Date.now() },
			() => {
				items = items.map(i => i.id === id ? { ...i, name, quantityInfo: quantityInfo || null, categoryOverride } : i);
				void updateOfflineItem(id, { name, quantityInfo: quantityInfo || null, categoryOverride, updatedAt: Math.floor(Date.now() / 1000) });
			}
		);
	}

	async function deleteItem(id: string) {
		await execute(
			() => fetch(`/api/items/${id}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error(); }),
			{ type: 'delete_item', payload: { id }, createdAt: Date.now() },
			() => {
				items = items.filter(i => i.id !== id);
				void deleteOfflineItem(id);
			}
		);
	}

	async function addFavorite(name: string, quantityInfo: string) {
		if (!favorites.some(f => f.name === name)) {
			favorites = [...favorites, { name, quantityInfo: quantityInfo || null, categoryOverride: null }];
		}
		await fetch('/api/favorites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, quantityInfo: quantityInfo || null, categoryOverride: null })
		});
	}

	async function toggleFavorite(name: string, makeFavorite: boolean) {
		const item = items.find(i => i.name === name);
		if (makeFavorite) {
			if (!favorites.some(f => f.name === name)) {
				favorites = [...favorites, { name, quantityInfo: item?.quantityInfo ?? null, categoryOverride: item?.categoryOverride ?? null }];
			}
			await fetch('/api/favorites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, quantityInfo: item?.quantityInfo ?? null, categoryOverride: item?.categoryOverride ?? null })
			});
		} else {
			favorites = favorites.filter(f => f.name !== name);
			await fetch('/api/favorites', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
		}
	}

	afterNavigate(({ to, from }) => {
		const fromId = from?.params?.id;
		const toId = to?.params?.id;

		// When navigating between different lists (component is reused by SvelteKit),
		// reset state so we don't briefly show the old list's items.
		if (fromId && toId && fromId !== toId) {
			items = [];
			loading = true;
			listName = '';
			addModalOpen = false;
			editItem = null;
			void loadItems();
		}

		// Handle shortcut ?action param — fires on every navigation incl. same-route
		const action = to?.url.searchParams.get('action');
		if (action === 'add' || action === 'scanner') {
			editItem = null;
			addModalOpen = true;
			autoScannerOnOpen = action === 'scanner';
			// Clean the URL so refreshing doesn't re-trigger the action
			history.replaceState({}, '', window.location.pathname);
		}
	});

	onMount(() => {
		void loadItems();
		const handleOnline = () => void loadItems();
		const handleVisibility = () => { if (document.visibilityState === 'visible') void loadItems(); };
		window.addEventListener('online', handleOnline);
		document.addEventListener('visibilitychange', handleVisibility);

		// Hinweis-Banner für kleine Bildschirme (< 374px), einmalig pro Gerät
		if (
			window.innerWidth < 374 &&
			userSettings.itemLayout === 'grid' &&
			!localStorage.getItem(LISTVIEW_HINT_KEY)
		) {
			showListViewHint = true;
		}

		// Hinweis-Banner für Location Service, einmalig pro Gerät
		if (
			!userSettings.locationNavEnabled &&
			!localStorage.getItem(LOCATION_HINT_KEY)
		) {
			showLocationHint = true;
		}

		const storedMode = localStorage.getItem(LIST_INTERACTION_MODE_KEY);
		if (storedMode === 'editing' || storedMode === 'normal') {
			listInteractionMode = storedMode;
		}

		if (window.visualViewport) {
			const onViewportResize = () => {
				keyboardOpen = (window.innerHeight - window.visualViewport!.height) > 100;
			};
			window.visualViewport.addEventListener('resize', onViewportResize);
			const removeViewport = () => window.visualViewport?.removeEventListener('resize', onViewportResize);
			const removeOnline = () => window.removeEventListener('online', handleOnline);
			const removeVisibility = () => document.removeEventListener('visibilitychange', handleVisibility);
			return () => { removeOnline(); removeViewport(); removeVisibility(); };
		}

		const removeVisibility = () => document.removeEventListener('visibilitychange', handleVisibility);
		return () => { window.removeEventListener('online', handleOnline); removeVisibility(); };
	});

	function dismissListViewHint(navigate = false) {
		showListViewHint = false;
		localStorage.setItem(LISTVIEW_HINT_KEY, '1');
		if (navigate) goto('/einstellungen');
	}

	function dismissLocationHint(navigate = false) {
		showLocationHint = false;
		localStorage.setItem(LOCATION_HINT_KEY, '1');
		if (navigate) goto('/einstellungen?expand=location');
	}

	function closeSearch() {
		searchOpen = false;
		searchQuery = '';
	}

	// SSE — Echtzeit-Updates via globalem SSE-Kanal (Verbindung liegt im Root-Layout)
	let sseConnectedSinceMount = false;
	function normalizeItem(item: Item): Item {
		return {
			...item,
			sortOrder: item.sortOrder ?? 0,
			createdAt: item.createdAt ?? item.updatedAt
		};
	}

	const offHandlers = [
		on('sse_connected', () => {
			// Beim Reconnect Items neu laden (bei erstem Connect schon via onMount geschehen)
			if (sseConnectedSinceMount) void loadItems();
			sseConnectedSinceMount = true;
		}),
		on('item_added', (ev) => {
			if (ev.listId !== listId) return;
			const item = normalizeItem(ev.item as Item);
			if (!items.some(i => i.id === item.id)) {
				items = [...items, item];
				void cacheItemsData(items);
			}
		}),
		on('item_updated', (ev) => {
			if (ev.listId !== listId) return;
			const patch = ev.item as Partial<Item> & { id: string };
			items = items.map(i =>
				i.id === patch.id
					? { ...i, ...patch, sortOrder: patch.sortOrder ?? i.sortOrder ?? 0, createdAt: i.createdAt ?? patch.updatedAt ?? i.updatedAt }
					: i
			);
			void updateOfflineItem(patch.id, patch);
		}),
		on('items_reordered', (ev) => {
			if (ev.listId !== listId || !Array.isArray(ev.itemIds)) return;
			const ordered = new Map((ev.itemIds as string[]).map((id, index) => [id, (index + 1) * 1000]));
			items = items.map(item => ordered.has(item.id) ? { ...item, sortOrder: ordered.get(item.id)! } : item);
			void cacheItemsData(items);
		}),
		on('item_deleted', (ev) => {
			if (ev.listId !== listId) return;
			items = items.filter(i => i.id !== ev.id);
			void deleteOfflineItem(ev.id as string);
		}),
	];

	onDestroy(() => offHandlers.forEach(off => off()));
</script>

<div class="h-[100dvh] flex flex-col overflow-hidden" style="background-color: var(--color-bg)">
	<AppHeader
		title={listName || 'Liste'}
		subtitle={headerSubtitle}
		onMenuOpen={() => menuOpen = true}
		onSearch={showSearch && !searchOpen ? () => searchOpen = true : null}
	/>

	<!-- Normal / Bearbeiten — fixiert unter dem Header -->
	{#if showListModeBar}
		<div
			class="fixed left-0 right-0 z-30 max-w-[430px] mx-auto px-4 py-1.5"
			style="top: calc(env(safe-area-inset-top) + 5.25rem); background-color: var(--color-bg)"
		>
			<ListInteractionModeBar mode={listInteractionMode} onChange={setListInteractionMode} />
		</div>
	{/if}

	<!-- Suchleiste (fixiert unter dem Header, nur wenn aktiv) -->
	{#if searchOpen}
		<div class="fixed left-0 right-0 z-30 max-w-[430px] mx-auto px-4 py-2"
		     style="top: {searchTop}; background-color: var(--color-bg)">
			<div class="flex items-center gap-2 rounded-xl px-3 py-2.5"
			     style="background-color: var(--color-surface-low)">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
				     stroke="var(--color-on-surface-variant)" stroke-width="2"
				     stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
					<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
				</svg>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					autofocus
					type="text"
					placeholder={t.list_search_placeholder}
					bind:value={searchQuery}
					onkeydown={(e) => e.key === 'Escape' && closeSearch()}
					class="flex-1 bg-transparent outline-none text-sm"
					style="color: var(--color-on-surface)"
				/>
				<button
					onclick={closeSearch}
					class="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
					style="background-color: var(--color-surface-high); color: var(--color-on-surface-variant)"
					aria-label={t.list_search_close_aria}
				>×</button>
			</div>
		</div>
	{/if}

	<!-- Hinweis-Banner für kleine Bildschirme -->
	{#if showListViewHint}
		<div class="fixed left-0 right-0 z-20 max-w-[430px] mx-auto px-4 pointer-events-none"
		     style="top: {listHintTop}">
			<div class="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl pointer-events-auto"
			     style="background-color: var(--color-surface-elevated); border: 1px solid var(--color-outline-variant)">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)"
				     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				<div class="flex-1 min-w-0">
					<p class="text-xs leading-snug" style="color: var(--color-on-surface-variant)">{t.listview_hint_text}</p>
					<button
						onclick={() => dismissListViewHint(true)}
						class="text-xs font-semibold mt-0.5"
						style="color: var(--color-primary)"
					>{t.listview_hint_action}</button>
				</div>
				<button
					onclick={() => dismissListViewHint(false)}
					class="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
					style="background-color: var(--color-surface-high); color: var(--color-on-surface-variant)"
					aria-label={t.hint_dismiss_aria}
				>×</button>
			</div>
		</div>
	{/if}

	<!-- Location-Hint-Banner -->
	{#if showLocationHint}
		<div class="fixed left-0 right-0 z-20 max-w-[430px] mx-auto px-4 pointer-events-none"
		     style="top: {locationHintTop}">
			<div class="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl pointer-events-auto"
			     style="background-color: var(--color-surface-elevated); border: 1px solid var(--color-outline-variant)">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)"
				     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				<div class="flex-1 min-w-0">
					<p class="text-xs leading-snug" style="color: var(--color-on-surface-variant)">{t.location_hint_text}</p>
					<button
						onclick={() => dismissLocationHint(true)}
						class="text-xs font-semibold mt-0.5"
						style="color: var(--color-primary)"
					>{t.location_hint_action}</button>
				</div>
				<button
					onclick={() => dismissLocationHint(false)}
					class="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
					style="background-color: var(--color-surface-high); color: var(--color-on-surface-variant)"
					aria-label={t.hint_dismiss_aria}
				>×</button>
			</div>
		</div>
	{/if}

	<!-- Bottom-Anchored Content -->
	<div bind:this={scrollContainer} class="flex-1 overflow-y-auto px-4 min-h-0"
	     style="padding-top: {contentTop}; padding-bottom: 5rem">
		<div class="min-h-full flex flex-col" class:justify-end={!searchQuery.trim() || !keyboardOpen}>
		{#if loading}
			<div class="flex justify-center py-8">
				<div class="w-6 h-6 rounded-full border-2 animate-spin"
				     style="border-color: var(--color-primary); border-top-color: transparent"></div>
			</div>
		{:else}
			<!-- CheckedDrawer – direkt über den offenen Items -->
			{#if checkedItems.length > 0}
				<CheckedDrawer checkedItems={displayCheckedItems} totalChecked={items.filter(i => i.isChecked).length} onUncheck={toggleItem} layout={userSettings.itemLayout} />
			{/if}

			{#if openItems.length === 0 && checkedItems.length === 0}
				<div class="text-center py-12">
					<p class="text-sm" style="color: var(--color-on-surface-variant)">{t.items_empty}</p>
				</div>
			{:else if displayItems.length === 0 && searchQuery.trim()}
				<div class="text-center py-12">
					<p class="text-sm" style="color: var(--color-on-surface-variant)">{t.list_search_no_results}</p>
				</div>
			{:else if displayItems.length > 0}

				{#if userSettings.itemLayout === 'list'}
					<!-- Listen-Ansicht: vertikale Zeilen, von unten nach oben -->
					<div class="flex flex-col gap-1 mt-2">
						{#each displayItems as item (item.id)}
							<div
								data-list-item-id={item.id}
								class="rounded-2xl overflow-hidden transition-opacity"
								class:duplicate-flash={flashingItemId === item.id}
								style={reorderDragId === item.id ? 'opacity: 0.45' : ''}
							>
								<ItemRow
									{item}
									interactionMode={effectiveListInteractionMode}
									onTap={() => toggleItemFromView(item)}
									onCommitName={(name) => void commitInlineName(item, name)}
									onVerticalNavigate={(d) => void navigateItemVertical(item, d)}
									onEnterNewBelow={(nextName) => void inlineEnterNewBelow(item, nextName)}
									onExitEmpty={() => void handleInlineExitEmpty(item)}
									onReorderMove={(d) => moveOpenItem(item, d)}
									onReorderGrab={(e) => startReorderDrag(e, item)}
									{suggestions}
									onSuggestionPick={(name) => void pickInlineSuggestion(item, name)}
									onLongPress={() => openItemEdit(item)}
									createdByUsername={item.createdByUsername}
									currentUsername={data.user?.username ?? null}
									isFavorite={favoriteNames.has(item.name.toLowerCase())}
								/>
							</div>
						{/each}
					</div>
				{:else}
				<!-- Kachel-Ansicht: 3er-Grid -->
				<div class="grid grid-cols-3 gap-2 mt-3" style={userSettings.categorySortEnabled && !manualOrderActive ? 'direction: rtl' : ''}>
					{#if userSettings.categorySortEnabled && !manualOrderActive}
						{#each { length: gridPrefix } as _}
							<div class="aspect-square"></div>
						{/each}
					{/if}
					{#each displayItems as item (item.id)}
						<div
							data-list-item-id={item.id}
							class="transition-opacity"
							class:duplicate-flash={flashingItemId === item.id}
							style={reorderDragId === item.id ? 'opacity: 0.45' : ''}
						>
							<ItemTile
								{item}
								interactionMode={effectiveListInteractionMode}
								onTap={() => toggleItemFromView(item)}
								onCommitName={(name) => void commitInlineName(item, name)}
								onVerticalNavigate={(d) => void navigateItemVertical(item, d)}
								onEnterNewBelow={(nextName) => void inlineEnterNewBelow(item, nextName)}
								onExitEmpty={() => void handleInlineExitEmpty(item)}
								onReorderMove={(d) => moveOpenItem(item, d)}
								onReorderGrab={(e) => startReorderDrag(e, item)}
								{suggestions}
								onSuggestionPick={(name) => void pickInlineSuggestion(item, name)}
								onLongPress={() => openItemEdit(item)}
								createdByUsername={item.createdByUsername}
								currentUsername={data.user?.username ?? null}
								isFavorite={favoriteNames.has(item.name.toLowerCase())}
							/>
						</div>
					{/each}
					{#if !userSettings.categorySortEnabled || manualOrderActive}
						{#each { length: gridPrefix } as _}
							<div class="aspect-square"></div>
						{/each}
					{/if}
				</div>
				{/if}<!-- end grid/list if -->
			{/if}
		{/if}
		</div>
	</div>

	{#if !addModalOpen && userPermission !== 'read'}
		<BottomNav
			onAdd={() => { editItem = null; autoFavoritesOnOpen = false; addModalOpen = true; }}
			onFavorites={() => { editItem = null; autoFavoritesOnOpen = true; addModalOpen = true; }}
		/>
	{/if}
</div>

<HamburgerMenu bind:open={menuOpen} user={data.user} />

<!-- Persistente Eingabeleiste für neue Items -->
{#if addModalOpen && !editItem}
	<AddItemBar
		onAdd={addItem}
		onClose={() => { addModalOpen = false; autoScannerOnOpen = false; autoFavoritesOnOpen = false; }}
		{suggestions}
		autoOpenScanner={autoScannerOnOpen}
		autoOpenFavorites={autoFavoritesOnOpen}
		{favorites}
		{activeItemNames}
		onRemoveFavorite={(name) => toggleFavorite(name, false)}
		onAddFavorite={addFavorite}
	/>
{/if}

<!-- Modal nur für Bearbeiten -->
{#if addModalOpen && editItem}
	<AddItemModal
		item={editItem}
		onSave={saveEditItem}
		onClose={() => { addModalOpen = false; editItem = null; }}
		onDelete={() => { const id = editItem!.id; addModalOpen = false; editItem = null; void deleteItem(id); }}
		isFavorite={favoriteNames.has((editItem?.name ?? '').toLowerCase())}
		onToggleFavorite={toggleFavorite}
	/>
{/if}

<style>
	:global(.duplicate-flash) {
		animation: duplicate-flash 500ms ease-in-out 2;
	}

	@keyframes duplicate-flash {
		0%, 100% { box-shadow: none; }
		35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 85%, transparent); }
	}
</style>

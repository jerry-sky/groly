<script lang="ts">
	import { getCategoryForItem } from '$lib/categories';
	import { userSettings } from '$lib/userSettings.svelte';
	import { t } from '$lib/i18n.svelte';
	import InlineItemName from '$lib/components/InlineItemName.svelte';
	import type { ListInteractionMode } from '$lib/listInteractionMode';

	let {
		item,
		interactionMode,
		onTap,
		onLongPress,
		onCommitName,
		onVerticalNavigate = null,
		onEnterNewBelow = null,
		onExitEmpty = null,
		onReorderMove = null,
		onReorderGrab = null,
		suggestions = [],
		onSuggestionPick = null,
		createdByUsername = null,
		currentUsername = null,
		isFavorite = false,
	}: {
		item: { id: string; name: string; quantityInfo: string | null; categoryOverride?: string | null };
		interactionMode: ListInteractionMode;
		onTap: () => void;
		onLongPress: () => void;
		onCommitName: (name: string) => void;
		onVerticalNavigate?: ((dir: -1 | 1) => void) | null;
		onEnterNewBelow?: ((trimmed: string) => void) | null;
		onExitEmpty?: (() => void) | null;
		onReorderMove?: ((dir: -1 | 1) => void) | null;
		onReorderGrab?: ((e: PointerEvent) => void) | null;
		suggestions?: string[];
		onSuggestionPick?: ((name: string) => void) | null;
		createdByUsername?: string | null;
		currentUsername?: string | null;
		isFavorite?: boolean;
	} = $props();

	const category = $derived(getCategoryForItem(item.name, item.categoryOverride));
	const showCreator = $derived(!!createdByUsername && createdByUsername !== currentUsername);
	const displayCreator = $derived(
		createdByUsername
			? '(' + (createdByUsername.length > 10 ? createdByUsername.slice(0, 10) + '…' : createdByUsername) + ')'
			: ''
	);

	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let longFired = $state(false);
	let nameHost = $state<HTMLElement | null>(null);
	let draftName = $state('');
	let nameFocused = $state(false);
	let draftTouched = $state(false);

	$effect(() => {
		if (!nameFocused) {
			draftName = item.name;
			draftTouched = false;
		}
	});

	const filteredSuggestions = $derived(
		draftName.trim().length > 0
			? suggestions
				.filter(s => s.toLowerCase().includes(draftName.trim().toLowerCase()) && s.toLowerCase() !== draftName.trim().toLowerCase())
				.slice(0, 5)
			: []
	);
	const reserveSuggestionSpace = $derived(interactionMode === 'editing' && item.name.trim() === '');
	const showInlineSuggestions = $derived(
		interactionMode === 'editing' &&
			(reserveSuggestionSpace || (nameFocused && draftTouched)) &&
			filteredSuggestions.length > 0
	);

	function consumeLongPress(): boolean {
		if (!longFired) return false;
		longFired = false;
		return true;
	}

	function startLongPress() {
		longFired = false;
		pressTimer = setTimeout(() => {
			longFired = true;
			pressTimer = null;
			onLongPress();
		}, 500);
	}

	function stopLongPress() {
		if (!pressTimer) return;
		clearTimeout(pressTimer);
		pressTimer = null;
	}

	function handleLongPressContextMenu(e: MouseEvent) {
		e.preventDefault();
		onLongPress();
	}

	function handleSurfaceClick(e: MouseEvent) {
		if (consumeLongPress()) return;
		const target = e.target as HTMLElement;
		if (target.closest('[data-list-reorder-handle]')) return;
		if (interactionMode === 'normal') {
			onTap();
			return;
		}
		if (target.closest('[data-inline-item-name]')) return;
		nameHost?.focus();
	}

	function handleReorderKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		onReorderMove?.(e.key === 'ArrowUp' ? -1 : 1);
	}
</script>

<!-- One physical row for both modes: normal disables the inline editor; edit enables it and swaps the reserved right slot to a grab handle. -->
<div
	class="w-full flex items-center px-3.5 gap-2 transition-opacity select-none {interactionMode === 'normal' ? 'h-[54px] active:opacity-70' : reserveSuggestionSpace || showInlineSuggestions ? 'min-h-[92px] py-3 cursor-text' : 'h-[54px] cursor-text'}"
	style="background-color: var(--color-surface-card); touch-action: pan-y;"
	onpointerdown={startLongPress}
	onpointerup={stopLongPress}
	onpointerleave={stopLongPress}
	onpointercancel={stopLongPress}
	onclick={handleSurfaceClick}
	oncontextmenu={handleLongPressContextMenu}
>
	<div class="relative flex-shrink-0 w-9 flex items-center justify-center pointer-events-none -ml-1">
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
		     stroke={category.color} stroke-width="1.3"
		     stroke-linecap="round" stroke-linejoin="round">
			{@html category.svgContent}
		</svg>
		{#if isFavorite && userSettings.showFavoriteIndicator}
			<span class="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full"
			      style="background-color: var(--color-primary)" aria-hidden="true"></span>
		{/if}
	</div>

	<div class="flex-1 min-w-0 overflow-hidden">
		<div class="flex items-baseline gap-1.5 overflow-hidden">
			<InlineItemName
				bind:hostEl={nameHost}
				itemId={item.id}
				name={item.name}
				editingEnabled={interactionMode === 'editing'}
				class="text-sm font-bold leading-none min-w-0 flex-1 outline-none max-h-[3.25rem] overflow-y-auto [&:not(:focus)]:truncate"
				style="color: var(--color-on-surface)"
				onCommit={onCommitName}
				onVerticalNavigate={onVerticalNavigate}
				onEnterNewBelow={onEnterNewBelow}
				onExitEmpty={onExitEmpty}
				onDraftChange={(next) => { draftName = next; draftTouched = true; }}
				onFocusChange={(next) => { nameFocused = next; if (!next) draftTouched = false; }}
			/>
			{#if item.quantityInfo}
				<span class="text-[10px] font-semibold leading-none flex-shrink-0"
				      style="color: {category.color}">{item.quantityInfo}</span>
			{/if}
		</div>
		{#if showInlineSuggestions || reserveSuggestionSpace}
			<div class="flex gap-1.5 flex-wrap mt-2 min-h-[1.625rem]">
				{#each filteredSuggestions as s}
					<button
						type="button"
						onpointerdown={(e) => e.preventDefault()}
						onclick={(e) => { e.stopPropagation(); draftName = s; draftTouched = false; onSuggestionPick?.(s); }}
						class="px-3 py-1.5 rounded-full text-xs font-medium"
						style="background-color: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary)"
					>
						{s}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if interactionMode === 'editing'}
		<button
			type="button"
			data-list-reorder-handle
			class="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl active:opacity-70 cursor-grab"
			style="touch-action: manipulation; background-color: var(--color-surface-high); color: var(--color-on-surface-variant)"
			aria-label={t.list_reorder_handle_aria}
			onpointerdown={(e) => onReorderGrab?.(e)}
			onkeydown={handleReorderKeydown}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
			     stroke="var(--color-on-surface-variant)" stroke-width="2"
			     stroke-linecap="round" stroke-linejoin="round">
				<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
				<circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
				<circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
				<circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
				<circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
				<circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
			</svg>
		</button>
	{:else}
		<div class="flex-shrink-0 w-9 h-9" aria-hidden="true"></div>
	{/if}

	{#if showCreator}
		<span class="text-[10px] font-semibold flex-shrink-0"
		      style="color: var(--color-on-surface-variant)">{displayCreator}</span>
	{/if}
</div>

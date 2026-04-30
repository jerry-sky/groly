<script lang="ts">
	import { getCategoryForItem } from '$lib/categories';
	import { onMount } from 'svelte';
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
		createdByUsername?: string | null;
		currentUsername?: string | null;
		isFavorite?: boolean;
	} = $props();

	const showCreator = $derived(!!createdByUsername && createdByUsername !== currentUsername);
	const displayCreator = $derived(
		createdByUsername
			? createdByUsername.length > 12
				? createdByUsername.slice(0, 12) + '…'
				: createdByUsername
			: ''
	);

	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let longFired = $state(false);

	const category = $derived(getCategoryForItem(item.name, item.categoryOverride));

	let nameEl = $state<HTMLElement | null>(null);
	let isTruncated = $state(false);

	let touchStartX = 0;
	let touchStartY = 0;
	let swipeConsumed = false;

	let showOverlay = $state(false);

	onMount(() => {
		checkTruncation();
	});

	$effect(() => {
		item.name;
		interactionMode;
		checkTruncation();
	});

	function checkTruncation() {
		if (nameEl) {
			isTruncated =
				nameEl.scrollHeight > nameEl.clientHeight || nameEl.scrollWidth > nameEl.clientWidth;
		}
	}

	function consumeInteractionGuard({ includeSwipe = true }: { includeSwipe?: boolean } = {}): boolean {
		if (longFired) {
			longFired = false;
			return true;
		}
		if (includeSwipe && swipeConsumed) {
			swipeConsumed = false;
			return true;
		}
		return false;
	}

	function startLongPress() {
		longFired = false;
		swipeConsumed = false;
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

	function handleClick() {
		if (consumeInteractionGuard()) return;
		onTap();
	}

	function handleEditSurfaceClick(e: MouseEvent) {
		if (consumeInteractionGuard({ includeSwipe: false })) return;
		const target = e.target as HTMLElement;
		if (target.closest('[data-tile-reorder-handle]')) return;
		if (target.closest('[data-inline-item-name]')) return;
		nameEl?.focus();
	}

	function handleReorderKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		onReorderMove?.(e.key === 'ArrowUp' ? -1 : 1);
	}

	function handleTouchStart(e: TouchEvent) {
		if (interactionMode === 'editing' || !isTruncated) return;
		const t = e.touches[0];
		touchStartX = t.clientX;
		touchStartY = t.clientY;
	}

	function handleTouchMove(e: TouchEvent) {
		if (interactionMode === 'editing' || swipeConsumed || !isTruncated) return;
		const t = e.touches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18) {
			if (pressTimer) {
				clearTimeout(pressTimer);
				pressTimer = null;
			}
			swipeConsumed = true;
			showOverlay = true;
		}
	}
</script>

{#if interactionMode === 'normal'}
	<!-- Normal: horizontal swipe on truncated names opens overlay with full text (see handleTouchMove / showOverlay). -->
	<div class="relative aspect-square" style="direction: ltr">
		<button
			onclick={handleClick}
			onpointerdown={startLongPress}
			onpointerup={stopLongPress}
			onpointerleave={stopLongPress}
			onpointercancel={stopLongPress}
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			oncontextmenu={handleLongPressContextMenu}
			class="w-full h-full rounded-3xl relative overflow-hidden active:scale-95 transition-transform select-none"
			style="background-color: var(--color-surface-card); touch-action: pan-y;"
		>
			{#if isFavorite && userSettings.showFavoriteIndicator}
				<span class="absolute top-3 left-3 w-2 h-2 rounded-full z-10"
				      style="background-color: var(--color-primary)" aria-hidden="true"></span>
			{/if}

			<span class="absolute top-2.5 right-2.5 text-[10px] font-semibold leading-none"
			      style="color: var(--color-on-surface-variant); visibility: {showCreator ? 'visible' : 'hidden'}">
				({displayCreator})
			</span>

			<div class="absolute inset-0 flex items-start justify-center pt-[30px] max-[374px]:pt-[22px]">
				<svg class="w-11 h-11 max-[374px]:w-9 max-[374px]:h-9" viewBox="0 0 24 24" fill="none"
				     stroke={category.color} stroke-width="1.3"
				     stroke-linecap="round" stroke-linejoin="round">
					{@html category.svgContent}
				</svg>
			</div>

			<div class="absolute bottom-0 left-0 right-0 px-2.5 pb-2 flex flex-col items-center justify-end h-[3.6rem] max-[374px]:h-[2.6rem]">
				<InlineItemName
					bind:hostEl={nameEl}
					itemId={item.id}
					name={item.name}
					editingEnabled={false}
					class="text-xs font-bold leading-snug line-clamp-2 max-[374px]:line-clamp-1 text-center w-full"
					style="color: var(--color-on-surface)"
					onCommit={onCommitName}
				/>
				<span class="text-[10px] leading-tight text-center mt-0.5 truncate w-full"
				      style="color: {category.color}; visibility: {item.quantityInfo ? 'visible' : 'hidden'}">
					{item.quantityInfo || '\u00a0'}
				</span>
			</div>
		</button>
	</div>
{:else}
	<!-- Edit: category icon decorative; large tap target focuses name; grab handle reorders without checking off. -->
	<div class="relative aspect-square" style="direction: ltr">
		<div
			class="w-full h-full rounded-3xl relative overflow-hidden flex flex-col active:scale-95 transition-transform cursor-text"
			style="background-color: var(--color-surface-card); touch-action: pan-y;"
			onpointerdown={startLongPress}
			onpointerup={stopLongPress}
			onpointerleave={stopLongPress}
			onpointercancel={stopLongPress}
			onclick={handleEditSurfaceClick}
			oncontextmenu={handleLongPressContextMenu}
		>
			{#if isFavorite && userSettings.showFavoriteIndicator}
				<span class="absolute top-3 left-3 w-2 h-2 rounded-full z-10"
				      style="background-color: var(--color-primary)" aria-hidden="true"></span>
			{/if}

			<span class="absolute top-2.5 right-2.5 text-[10px] font-semibold leading-none pointer-events-none"
			      style="color: var(--color-on-surface-variant); visibility: {showCreator ? 'visible' : 'hidden'}">
				({displayCreator})
			</span>

			<div class="pointer-events-none absolute inset-0 flex items-start justify-center pt-[30px] max-[374px]:pt-[22px]">
				<svg class="w-11 h-11 max-[374px]:w-9 max-[374px]:h-9" viewBox="0 0 24 24" fill="none"
				     stroke={category.color} stroke-width="1.3"
				     stroke-linecap="round" stroke-linejoin="round">
					{@html category.svgContent}
				</svg>
			</div>

			<div
				class="mt-auto flex flex-col items-stretch justify-end h-[3.6rem] max-[374px]:h-[2.6rem] px-2.5 pb-2 w-full min-h-0 gap-0.5"
			>
				<div class="flex flex-row items-end gap-1 w-full min-h-0 flex-1">
					<InlineItemName
						bind:hostEl={nameEl}
						itemId={item.id}
						name={item.name}
						editingEnabled={true}
						class="text-xs font-bold leading-snug text-left flex-1 min-w-0 outline-none max-h-full overflow-y-auto [&:not(:focus)]:line-clamp-2 max-[374px]:[&:not(:focus)]:line-clamp-1"
						style="color: var(--color-on-surface)"
						onCommit={onCommitName}
						onVerticalNavigate={onVerticalNavigate}
						onEnterNewBelow={onEnterNewBelow}
						onExitEmpty={onExitEmpty}
					/>
					<button
						type="button"
						data-tile-reorder-handle
						class="flex-shrink-0 w-9 h-9 max-[374px]:w-8 max-[374px]:h-8 rounded-xl flex items-center justify-center active:opacity-70 cursor-grab mb-px"
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
				</div>
				<span class="text-[10px] leading-tight text-center truncate w-full pointer-events-none"
				      style="color: {category.color}; visibility: {item.quantityInfo ? 'visible' : 'hidden'}">
					{item.quantityInfo || '\u00a0'}
				</span>
			</div>
		</div>
	</div>
{/if}

{#if showOverlay}
	<div
		role="button"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center"
		onclick={() => (showOverlay = false)}
		onkeydown={(e) => {
			if (e.key === 'Escape') showOverlay = false;
		}}
	>
		<div class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
		<div class="relative rounded-2xl px-6 py-5 mx-6 text-center shadow-2xl"
		     style="background-color: var(--color-surface-card); max-width: 80vw">
			<p class="text-sm font-bold leading-snug" style="color: var(--color-on-surface)">{item.name}</p>
			{#if item.quantityInfo}
				<p class="text-xs mt-1.5 font-medium" style="color: {category.color}">{item.quantityInfo}</p>
			{/if}
		</div>
	</div>
{/if}

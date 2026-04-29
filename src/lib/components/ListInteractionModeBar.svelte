<script lang="ts">
	import { t } from '$lib/i18n.svelte';
	import type { ListInteractionMode } from '$lib/listInteractionMode';

	let { mode, onChange }: { mode: ListInteractionMode; onChange: (m: ListInteractionMode) => void } = $props();
</script>

<div class="flex rounded-xl p-0.5 gap-0" style="background-color: var(--color-surface-low)" role="group" aria-label={t.list_interaction_mode_group_label}>
	<button
		type="button"
		class="flex-1 min-w-0 py-2 px-2 text-xs font-semibold rounded-[0.625rem] transition-colors"
		style={mode === 'normal'
			? 'background-color: var(--color-surface-card); color: var(--color-on-surface); box-shadow: 0 1px 2px color-mix(in srgb, black 8%, transparent)'
			: 'background-color: transparent; color: var(--color-on-surface-variant)'}
		aria-pressed={mode === 'normal'}
		onclick={() => onChange('normal')}
	>
		{t.list_mode_normal}
	</button>
	<button
		type="button"
		class="flex-1 min-w-0 py-2 px-2 text-xs font-semibold rounded-[0.625rem] transition-colors"
		style={mode === 'editing'
			? 'background-color: var(--color-surface-card); color: var(--color-on-surface); box-shadow: 0 1px 2px color-mix(in srgb, black 8%, transparent)'
			: 'background-color: transparent; color: var(--color-on-surface-variant)'}
		aria-pressed={mode === 'editing'}
		onclick={() => onChange('editing')}
	>
		{t.list_mode_edit}
	</button>
</div>

/**
 * open-counter — the homepage's live island, and the source of the hero sample.
 *
 * The component is the demo AND the sample: generate-site-content-data.ts
 * extracts the `#home-sample` marked body below and compiles it with the
 * site's one Shiki pipeline, so the page can never show code the island does
 * not run. Keep the excerpt short enough to read in the hero panel (the
 * generator enforces a line ceiling) and keep the markers around the body.
 *
 * Reset is disabled at zero. When the browser drops the disabled reset
 * button from the focus order, the handler moves focus to the increment
 * button. The count sits in a polite live region, so
 * both an increment and a reset announce their result — reset has no other
 * announcement of its own.
 */
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'open-counter',
  root: 'shadow',
  hydrate: 'visible',
  ssr: true,
  properties: {
    label: { default: 'Count:' },
    reset: { default: 'Reset' },
    increment: { default: 'Increment count, currently' },
  },
});

type CounterProps = { label: string; reset: string; increment: string };

// #home-sample:start
export default function OpenCounter(props: CounterProps) {
  const count = signal(0);
  return (
    <div part='demo'>
      <button
        type='button'
        part='button'
        aria-label={props.increment + ' ' + count.value}
        onClick={() => count.value++}
      >
        <span aria-live='polite'>{props.label + ' ' + count.value}</span>
      </button>
      <button
        type='button'
        part='reset'
        disabled={count.value === 0}
        onClick={({ currentTarget: reset }: Event) => {
          count.value = 0;
          (reset as HTMLElement).parentElement?.querySelector('button')?.focus();
        }}
      >
        {props.reset}
      </button>
    </div>
  );
}
// #home-sample:end

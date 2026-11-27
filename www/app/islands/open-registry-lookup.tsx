import { onConnect } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { connectRegistryLookup } from '../site-ui/open-registry-lookup-controller.ts';

export const openElement = defineIslandConfig({
  tag: 'open-registry-lookup',
  root: 'light',
  hydrate: 'load',
  ssr: true,
  properties: {
    label: { default: '' },
    example: { default: '' },
    submit: { default: '' },
    hint: { default: '' },
  },
});

function OpenRegistryLookup(props: {
  label: string;
  example: string;
  submit: string;
  hint: string;
}) {
  onConnect(({ host, signal }) => {
    // The form's hidden attribute is an SSR claim seed. Reveal it after the
    // generated element has claimed the server-rendered form.
    globalThis.queueMicrotask(() => {
      if (!signal.aborted) connectRegistryLookup(host, signal);
    });
  });

  return (
    <form
      class='mb-5 max-w-2xl scroll-mt-[calc(var(--nav-height)+1rem)]'
      role='search'
      aria-label={props.label}
      hidden
    >
      <label for='registry-query' class='mb-2 block text-sm font-semibold text-foreground'>
        {props.label}
      </label>
      <div class='flex gap-2'>
        <input
          class='min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-base text-foreground placeholder:text-muted-foreground'
          id='registry-query'
          aria-describedby='registry-query-hint'
          type='search'
          placeholder={props.example}
          autocomplete='off'
          spellcheck='false'
          required
        />
        <button
          type='submit'
          class='min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground'
        >
          {props.submit}
        </button>
      </div>
      <p id='registry-query-hint' class='mt-2 mb-0 text-sm text-muted-foreground empty:hidden'>
        {props.hint}
      </p>
      <p class='mt-2 mb-0 text-sm text-muted-foreground empty:hidden' role='status'></p>
      <ul
        id='registry-results'
        class='mt-2 mb-0 list-none divide-y divide-border p-0 empty:hidden'
      ></ul>
      <div class='mt-2 flex gap-4' data-lookup-pages hidden>
        <button
          type='button'
          class='min-h-11 text-sm text-primary underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline'
          aria-controls='registry-results'
          data-lookup-prev
        ></button>
        <button
          type='button'
          class='min-h-11 text-sm text-primary underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline'
          aria-controls='registry-results'
          data-lookup-next
        ></button>
      </div>
    </form>
  );
}

export default OpenRegistryLookup;

import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'only',
  ssr: false,
  root: 'shadow',
});

export default function LateForm() {
  const visible = signal(false);
  return (
    <section>
      <button type="button" onClick={() => (visible.value = true)}>Reveal form</button>
      {visible.value ? (
        <form method="post" data-open-enhance>
          <button type="submit">Submit late form</button>
        </form>
      ) : null}
    </section>
  );
}

import { Head } from 'fresh/runtime';
import PreactCounter from '../islands/PreactCounter.tsx';
import OpenElements from '../islands/OpenElements.tsx';

export default function Home() {
  return (
    <>
      <Head>
        <title>openElement in Fresh — 0.42.0-alpha.11 Interop Proof</title>
        <meta
          name='description'
          content='Demonstrates openElement custom elements running inside a Fresh app with Preact islands.'
        />
      </Head>

      <main
        style={{
          maxWidth: '720px',
          margin: '2rem auto',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1>openElement + Fresh 0.42.0-alpha.11</h1>
        <p>
          This page renders <code>&lt;open-button&gt;</code> and <code>&lt;open-card&gt;</code>{' '}
          as standard HTML custom elements, registered by the <code>OpenElements</code>{' '}
          island from the real <code>@openelement/ui</code>{' '}
          package (published npm artifact with pre-transpiled <code>jsx()</code> output).
        </p>

        <h2>open-button</h2>
        <open-button variant='primary'>Primary Button</open-button>
        <open-button>Default Button</open-button>
        <open-button variant='ghost' size='sm'>Ghost Small</open-button>

        <h2>open-card</h2>
        <open-card>
          <h3 slot='header'>Card with Slots</h3>
          <p>This card content is rendered in the default slot.</p>
          <p slot='footer'>Footer slot content</p>
        </open-card>

        {/* Fresh Preact island — proves bilateral interop */}
        <h2>Preact Island Counter</h2>
        <p>
          The counter below is a Fresh <em>island</em>{' '}
          backed by a Preact functional component. It proves Preact islands work alongside
          openElement custom elements in the same page.
        </p>
        <PreactCounter />

        {/* openElement boot island — registers and hydrates custom elements */}
        <OpenElements />
      </main>
    </>
  );
}

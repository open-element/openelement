import type { JSX } from 'preact';

// The demo renders openElement custom elements as plain HTML tags. Preact's
// JSX type-checker does not know them, so declare them here (the runtime
// classes are registered by the OpenElements island).
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'open-button': JSX.HTMLAttributes<HTMLElement> & {
        variant?: string;
        size?: string;
      };
      'open-card': JSX.HTMLAttributes<HTMLElement>;
    }
  }
}

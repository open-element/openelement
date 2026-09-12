import type { Signal } from '@preact/signals';

interface PreactCounterProps {
  count: Signal<number>;
}

export default function PreactCounter({ count }: PreactCounterProps) {
  return (
    <button
      type='button'
      onClick={() => count.value += 1}
      style={{
        padding: '0.5rem 1rem',
        fontSize: '1rem',
        cursor: 'pointer',
        border: '1px solid #ccc',
        borderRadius: '4px',
        background: '#f0f0f0',
      }}
    >
      Count: {count}
    </button>
  );
}

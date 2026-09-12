import PreactCounter from '../components/PreactCounter.tsx';
import { useSignal } from '@preact/signals';

export default function PreactCounterIsland() {
  const count = useSignal(0);
  return <PreactCounter count={count} />;
}

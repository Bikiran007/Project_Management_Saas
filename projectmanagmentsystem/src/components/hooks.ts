import { useSearchParams } from 'react-router-dom';

/** Open the task drawer on top of the current page via ?task=<id>. */
export function useOpenTask() {
  const [sp, setSp] = useSearchParams();
  return (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('task', id);
    setSp(n);
  };
}

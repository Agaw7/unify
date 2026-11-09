'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CalendarCheck, CheckCircle2, Gift, LoaderCircle, X } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';

export default function HomeRewards({ onTasks, onClaim }: { onTasks: () => void; onClaim: () => void }) {
  const [panel, setPanel] = useState<'Gift code' | 'Daily check-in' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

  function open(next: typeof panel) {
    setPanel(next);
    setMessage('');
    setError('');
  }

  async function claim(checkIn: boolean, code?: FormDataEntryValue | null) {
    if (lock.current) return;
    if (checkIn) setPanel('Daily check-in');
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await moneyRequest('/api/rewards', checkIn ? { action: 'check-in' } : { action: 'redeem', code });
      const amount = (Number(result.amount) / 100).toFixed(2);
      setMessage(result.alreadyClaimed ? (checkIn ? 'You already checked in today.' : 'Reward already claimed.') : `₱${amount} credited to your available balance.`);
      onClaim();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to claim reward.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void claim(false, new FormData(event.currentTarget).get('code'));
  }

  return <>
    <section className="home-reward-shortcuts" aria-label="Rewards shortcuts">
      <button type="button" disabled={busy} onClick={() => open('Gift code')}><span className="member-menu-icon" aria-hidden="true"><Gift size={22} /></span><span>Gift code</span></button>
      <button type="button" disabled={busy} onClick={() => void claim(true)}><span className="member-menu-icon" aria-hidden="true"><CalendarCheck size={22} /></span><span>{busy && panel==='Daily check-in' ? 'Checking in…' : 'Daily check-in'}</span></button>
      <button type="button" disabled={busy} onClick={onTasks}><span className="member-menu-icon" aria-hidden="true"><CheckCircle2 size={22} /></span><span>Tasks</span></button>
    </section>
    <dialog ref={dialog} className="home-reward-dialog" aria-labelledby="home-reward-title" onCancel={()=>open(null)} onClose={()=>setPanel(null)} onClick={event=>{if(event.target===event.currentTarget)open(null);}}>
      <div className="home-reward-panel">
        <div className="home-reward-panel-header"><h3 id="home-reward-title">{panel}</h3><button type="button" aria-label="Close reward panel" onClick={() => open(null)}><X size={19} /></button></div>
        {panel==='Gift code' && <form onSubmit={submit}>
          <label><span className="sr-only">Gift code</span><input name="code" placeholder="A-XXXXXX" required minLength={8} maxLength={24} autoComplete="off" disabled={busy}/></label>
          <button type="submit" className="invest-now-button" disabled={busy}>{busy ? 'Redeeming…' : 'Redeem'}</button>
        </form>}
        {panel==='Daily check-in' && <div className="home-check-in-result" aria-busy={busy}>
          <span className={`home-check-in-icon${error?' has-error':''}`}>{busy?<LoaderCircle size={30} className="reward-spinner"/>:error?<AlertCircle size={30}/>:<CheckCircle2 size={30}/>}</span>
          {busy && <p role="status">Checking in…</p>}
        </div>}
        {message && <p className="home-reward-message" role="status">{message}</p>}
        {error && <p className="home-reward-error" role="alert">{error}</p>}
      </div>
    </dialog>
  </>;
}

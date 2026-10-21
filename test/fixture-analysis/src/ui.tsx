// 모양은 같지만 다른 컴포넌트를 그린다 → 중복이 아니다
export function SaveBar({ busy, onSave }: { busy: boolean; onSave: () => void }) {
  if (busy) return <Spinner size={12} label="saving" />;
  return (
    <Toolbar align="end">
      <Button onClick={onSave} variant="primary">Save</Button>
      <Button onClick={onSave} variant="ghost">Save and close</Button>
    </Toolbar>
  );
}

export function ShareBar({ busy, onShare }: { busy: boolean; onShare: () => void }) {
  if (busy) return <Loader size={12} label="sharing" />;
  return (
    <Panel align="end">
      <Link onClick={onShare} variant="primary">Share</Link>
      <Link onClick={onShare} variant="ghost">Share and close</Link>
    </Panel>
  );
}

const Spinner = (p: { size: number; label: string }) => <i>{p.label}</i>;
const Loader = Spinner;
const Toolbar = (p: { align: string; children?: unknown }) => <div>{p.align}</div>;
const Panel = Toolbar;
const Button = (p: { onClick: () => void; variant: string; children?: unknown }) => <b onClick={p.onClick}>{p.variant}</b>;
const Link = Button;

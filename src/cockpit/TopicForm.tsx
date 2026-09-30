// src/cockpit/TopicForm.tsx — the name field and Start button for a new topic,
// shared by the Talk screen's New topic and the Share screen's New topic row.
import { useState } from 'react';
import { Button } from '../ui';

export function TopicForm({ onStart }: { onStart: (name: string) => void }) {
  const [name, setName] = useState('');
  const start = () => {
    const topic = name.trim();
    if (!topic) return;
    onStart(topic);
    setName('');
  };
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="What about?" aria-label="New topic" className="h-8 flex-1 text-sm" autoFocus />
      <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
        Start
      </Button>
    </form>
  );
}

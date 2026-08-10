/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AudioAccessControl } from './AudioAccessControl';
import type { AudioAccessMode } from './newViewModel';

function ControlledFilter() {
  const [mode, setMode] = useState<AudioAccessMode>('full');
  return <AudioAccessControl mode={mode} onChange={setMode} label="Playback access" />;
}

describe('AudioAccessControl', () => {
  it('exposes a single radio selection and updates its controlled value', async () => {
    const user = userEvent.setup();
    render(<ControlledFilter />);

    expect(screen.getByRole('radiogroup', { name: 'Playback access' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Full tracks' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Previews' }));

    expect(screen.getByRole('radio', { name: 'Full tracks' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Previews' })).toHaveAttribute('aria-checked', 'true');
  });
});

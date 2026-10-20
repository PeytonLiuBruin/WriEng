import { useId, useState } from 'react';
import type { Settings } from './engine';
import { playStudySound, setStudySoundPreferences } from './study-audio';
import './sound-settings.css';

export interface SoundSettingsProps {
  settings: Pick<Settings, 'soundEnabled' | 'soundVolume'>;
  disabled?: boolean;
  onChange: (patch: Partial<Settings>) => void | Promise<void>;
}

export function SoundSettings({ settings, disabled = false, onChange }: SoundSettingsProps) {
  const sliderId = useId();
  const [error, setError] = useState('');
  const storedVolume = settings.soundVolume ?? 0.12;
  const volume = Math.round(Math.max(0, Math.min(1, Number.isFinite(storedVolume) ? storedVolume : 0.12)) * 100);

  async function change(patch: Partial<Settings>) {
    setError('');
    setStudySoundPreferences({ ...settings, ...patch });
    try { await onChange(patch); }
    catch {
      setStudySoundPreferences(settings);
      setError('音效设置尚未保存，请重试。');
    }
  }

  return <fieldset className="sound-settings" disabled={disabled}>
    <legend>操作音效</legend>
    <div className="sound-settings-heading">
      <label className="sound-mute"><input type="checkbox" data-testid="sound-muted" checked={!settings.soundEnabled}
        onChange={event => { void change({ soundEnabled: !event.target.checked }); }} />静音</label>
      <button type="button" className="sound-preview" data-testid="sound-preview" disabled={!settings.soundEnabled || volume === 0}
        onClick={() => playStudySound('preview', settings)}>试听音效</button>
    </div>
    <label className="sound-volume-label" htmlFor={sliderId}>音效音量 <output htmlFor={sliderId}>{volume}%</output></label>
    <input id={sliderId} data-testid="sound-volume" type="range" min="0" max="100" step="1" value={volume} aria-valuetext={`${volume}%`}
      onChange={event => { void change({ soundVolume: Number(event.target.value) / 100 }); }} />
    <p>轻声提示操作，静音不影响学习。</p>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

export default SoundSettings;

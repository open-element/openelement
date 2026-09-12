import { assertEquals } from '@std/assert';

import { loadSettings, saveSettings } from '../storage.ts';

function resetStorage() {
  localStorage.clear();
}

Deno.test('loadSettings returns defaults on first load', () => {
  resetStorage();
  const s = loadSettings();
  assertEquals(s.theme, 'light');
  assertEquals(s.fontSize, 16);
  assertEquals(s.lineHeight, 1.6);
  assertEquals(s.measure, 65);
});

Deno.test('saveSettings persists and merges with defaults', () => {
  resetStorage();
  saveSettings({ theme: 'dark' });
  const s = loadSettings();
  assertEquals(s.theme, 'dark');
  assertEquals(s.fontSize, 16);
  assertEquals(s.lineHeight, 1.6);
  assertEquals(s.measure, 65);
});

Deno.test('saveSettings partial update preserves other custom fields', () => {
  resetStorage();
  saveSettings({ theme: 'dark', fontSize: 20 });
  saveSettings({ theme: 'sepia' });
  const s = loadSettings();
  assertEquals(s.theme, 'sepia');
  assertEquals(s.fontSize, 20);
  assertEquals(s.lineHeight, 1.6);
  assertEquals(s.measure, 65);
});

Deno.test('corrupt JSON in settings returns defaults', () => {
  resetStorage();
  localStorage.setItem('reader:settings', '{invalid json');
  const s = loadSettings();
  assertEquals(s.theme, 'light');
  assertEquals(s.fontSize, 16);
});

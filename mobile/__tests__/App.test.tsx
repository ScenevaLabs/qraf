/**
 * @format
 */

import React from 'react';
import App from '../App';
import { render, texts } from '../test-utils/render';

test('oturum yokken giriş ekranı açılır', async () => {
  const r = await render(<App />);
  expect(texts(r.root)).toContain('SEND CODE');
});

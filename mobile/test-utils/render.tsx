// Ekran testleri için ortak yardımcılar.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

export function texts(root: ReactTestRenderer.ReactTestInstance): string[] {
  return root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
}

// Verilen metnin üstündeki ilk dokunulabilir öğe (Pressable).
export function pressableWithText(root: ReactTestRenderer.ReactTestInstance, text: string) {
  const label = root.findAll((n) => n.type === Text && [].concat(n.props.children).join('') === text)[0];
  let node: ReactTestRenderer.ReactTestInstance | null = label;
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  if (!node) throw new Error(`dokunulabilir öğe yok: ${text}`);
  return node;
}

// Her test sonunda ekranlar kapatılır — açık kalan zamanlayıcı
// (ör. klasöre kaydırma) test bittikten sonra çalışmasın.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((r) => r.unmount()));
});

export async function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(el);
  });
  mounted.push(r);
  return r;
}


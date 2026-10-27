import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseAddons } from './CourseAddons';
import type { CourseAddon } from '@/lib/libraryApi';
const offer: CourseAddon={offerId:1,title:'Optional resource',description:'Additional help',available:true,href:'/checkout/real-offer'};
describe('Optional course purchases',()=>{
  it('does not show an empty section',()=>expect(renderToStaticMarkup(<CourseAddons />)).toBe(''));
  it('shows separate purchase disclosure and normal checkout links without claiming a price',()=>{
    const html=renderToStaticMarkup(<CourseAddons items={[offer]} />);
    expect(html).toContain('Optional add-ons'); expect(html).toContain('separate purchases');
    expect(html).toContain('href="/checkout/real-offer"'); expect(html).not.toContain('$');
  });
  it('never makes unavailable, external or unsafe destinations clickable',()=>{
    for(const item of [{...offer,available:false},{...offer,href:null},{...offer,href:'javascript:alert(1)'},{...offer,href:'//evil.invalid/checkout/o'}]) {
      const html=renderToStaticMarkup(<CourseAddons items={[item]} />);
      expect(html).not.toContain('<a '); expect(html).toContain('Currently unavailable');
    }
  });
  it('renders administrator content as text',()=>{
    const html=renderToStaticMarkup(<CourseAddons items={[{...offer,title:'<script>alert(1)</script>',description:'<img src=x onerror=alert(1)>'}]} />);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img '); expect(html).toContain('&lt;script&gt;');
  });
});

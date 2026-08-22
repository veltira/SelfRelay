import assert from 'node:assert/strict';
import test from 'node:test';
import {setDisclosureState,toggleDisclosure} from '../src/disclosure.ts';

class FakeButton{
  attrs=new Map<string,string>();
  getAttribute(name:string){return this.attrs.get(name)??null;}
  setAttribute(name:string,value:string){this.attrs.set(name,value);}
}
class FakePanel{hidden=true;}

test('advanced tracking disclosure starts closed and toggles indefinitely',()=>{
  const button=new FakeButton(),panel=new FakePanel();
  setDisclosureState(button as any,panel as any,false);
  assert.equal(panel.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(toggleDisclosure(button as any,panel as any),true);assert.equal(panel.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.equal(toggleDisclosure(button as any,panel as any),false);assert.equal(panel.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');
  for(let i=0;i<6;i++){const expected=i%2===0;assert.equal(toggleDisclosure(button as any,panel as any),expected);assert.equal(panel.hidden,!expected);assert.equal(button.getAttribute('aria-expanded'),String(expected));}
});

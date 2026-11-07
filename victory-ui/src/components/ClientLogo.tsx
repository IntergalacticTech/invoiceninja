import { useState } from 'react';
import allocation from '../assets/clients/allocation-specialists.jpg';
import endeavor from '../assets/clients/endeavor.png';
import orchard from '../assets/clients/orchard.png';
import rethink from '../assets/clients/rethink.png';
import victory from '../assets/clients/victory.png';
import youngLife from '../assets/clients/young-life.png';

const brands = [
  { names: ['Allocation Specialists'], host: 'aslqb.com', logo: allocation },
  { names: ['Endeavor Real Estate Group'], host: 'endeavor-re.com', logo: endeavor },
  { names: ['Orchard Alliance'], host: 'orchardalliance.org', logo: orchard },
  { names: ['Rethink Capital Partners'], host: 'rethink-capital.com', logo: rethink },
  { names: ['Victory', 'Victory - Talent Pool', 'VictoryCTO'], host: 'victorycto.com', logo: victory },
  { names: ['Young Life'], host: 'younglife.org', logo: youngLife },
];

export function clientLogo(name: string, website?: string): string | undefined {
  let host = '';
  try { host = new URL(website?.includes('://') ? website : `https://${website}`).hostname.replace(/^www\./, ''); } catch { /* The name can still match. */ }
  return brands.find(brand => brand.host === host || brand.names.some(alias => alias.toLowerCase() === name.trim().toLowerCase()))?.logo;
}

const colors = ['#236b8e', '#7251a0', '#b34f39', '#387850', '#9b6420', '#397b82'];

/** Bundled images keep client identity visible without a third-party request on every card. */
export function ClientLogo({ name, website }: { name: string; website?: string }) {
  const source = clientLogo(name, website);
  const [failed, setFailed] = useState<string>();
  const showImage = source && failed !== source;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  const hash = [...name.toLowerCase()].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return <span className={`client-logo${showImage ? ' has-logo' : ''}`} style={{ backgroundColor: showImage ? '#fff' : colors[hash % colors.length] }} aria-hidden="true">
    {showImage ? <img src={source} alt="" width={32} height={32} onError={() => setFailed(source)} /> : initials}
  </span>;
}

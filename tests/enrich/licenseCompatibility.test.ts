// tests/enrich/licenseCompatibility.test.ts
import { describe, it, expect } from 'vitest';
import {
  checkLicenseCompatibility,
  type LicenseCheck,
} from '../../src/enrich/licenseCompatibility.js';

describe('checkLicenseCompatibility', () => {
  it('MIT wheel + MIT user → compatible true', () => {
    const r = checkLicenseCompatibility('MIT', 'MIT');
    expect(r.compatible).toBe(true);
    expect(r.note).toContain('compatible');
  });

  it('MIT wheel + GPL-3.0 user → compatible true (permissive wheel)', () => {
    const r = checkLicenseCompatibility('MIT', 'GPL-3.0');
    expect(r.compatible).toBe(true);
  });

  it('GPL-3.0 wheel + MIT user → compatible false (GPL contagion)', () => {
    const r = checkLicenseCompatibility('GPL-3.0', 'MIT');
    expect(r.compatible).toBe(false);
    expect(r.note).toContain('not compatible');
  });

  it('GPL-3.0 wheel + GPL-3.0 user → compatible true', () => {
    const r = checkLicenseCompatibility('GPL-3.0', 'GPL-3.0');
    expect(r.compatible).toBe(true);
  });

  it('GPL-2.0 wheel + Apache-2.0 user → compatible false', () => {
    const r = checkLicenseCompatibility('GPL-2.0', 'Apache-2.0');
    expect(r.compatible).toBe(false);
  });

  it('Apache-2.0 wheel + GPL-2.0 user → compatible false', () => {
    const r = checkLicenseCompatibility('Apache-2.0', 'GPL-2.0');
    expect(r.compatible).toBe(false);
  });

  it('Apache-2.0 wheel + MIT user → compatible true', () => {
    const r = checkLicenseCompatibility('Apache-2.0', 'MIT');
    expect(r.compatible).toBe(true);
  });

  it('wheelLicense undefined → compatible null', () => {
    const r = checkLicenseCompatibility(undefined, 'MIT');
    expect(r.compatible).toBe(null);
  });

  it('userLicense undefined → compatible null', () => {
    const r = checkLicenseCompatibility('MIT', undefined);
    expect(r.compatible).toBe(null);
  });

  it('unknown license (WTFPL) → compatible null', () => {
    const r = checkLicenseCompatibility('WTFPL', 'MIT');
    expect(r.compatible).toBe(null);
    expect(r.note).toContain('unknown');
  });

  it('case insensitive: mit + apache 2.0 works', () => {
    const r = checkLicenseCompatibility('mit', 'apache 2.0');
    expect(r.compatible).toBe(true);
  });

  it('LGPL wheel + MIT user → compatible true (LGPL permissive)', () => {
    const r = checkLicenseCompatibility('LGPL', 'MIT');
    expect(r.compatible).toBe(true);
  });

  it('normalizes common variants (MIT License, Apache 2.0, GPLv3)', () => {
    const r1 = checkLicenseCompatibility('MIT License', 'MIT');
    expect(r1.compatible).toBe(true);
    const r2 = checkLicenseCompatibility('GPLv3', 'GPL-3.0');
    expect(r2.compatible).toBe(true);
    const r3 = checkLicenseCompatibility('Apache 2.0', 'GPL-2.0');
    expect(r3.compatible).toBe(false);
  });

  it('LicenseCheck return type shape', () => {
    const r: LicenseCheck = checkLicenseCompatibility('MIT', 'MIT');
    expect(r).toHaveProperty('compatible');
    expect(r).toHaveProperty('note');
    expect(typeof r.note).toBe('string');
  });
});

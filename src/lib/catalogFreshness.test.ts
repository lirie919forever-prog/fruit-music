import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import {
  CATALOG_STALE_TIME_MS,
  catalogStaleTime,
  countFederatedResults,
  countListResults,
} from './catalogFreshness';

function query<T>(data: T): Query<T, Error, T, readonly unknown[]> {
  return { state: { data } } as Query<T, Error, T, readonly unknown[]>;
}

describe('countFederatedResults', () => {
  it('counts the records inside a federated envelope', () => {
    expect(countFederatedResults({ results: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    expect(countFederatedResults({ results: [] })).toBe(0);
  });

  it('treats a missing or malformed payload as empty', () => {
    expect(countFederatedResults(undefined)).toBe(0);
    expect(countFederatedResults(null)).toBe(0);
    expect(countFederatedResults({ results: 'nope' })).toBe(0);
  });
});

describe('countListResults', () => {
  it('counts both bare arrays and federated envelopes', () => {
    expect(countListResults([{ id: 'a' }])).toBe(1);
    expect(countListResults({ results: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    expect(countListResults([])).toBe(0);
    expect(countListResults(undefined)).toBe(0);
  });
});

describe('catalogStaleTime', () => {
  it('holds a populated catalog fresh for the full window', () => {
    const staleTime = catalogStaleTime(countListResults);
    expect(staleTime(query([{ id: 'a' }]))).toBe(CATALOG_STALE_TIME_MS);
    expect(staleTime(query({ results: [{ id: 'a' }] }))).toBe(CATALOG_STALE_TIME_MS);
  });

  it('never holds an empty catalog fresh, so a transient gap refetches', () => {
    const staleTime = catalogStaleTime(countListResults);
    expect(staleTime(query([]))).toBe(0);
    expect(staleTime(query({ results: [] }))).toBe(0);
    expect(staleTime(query(undefined))).toBe(0);
  });
});

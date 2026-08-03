/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { getOptionName } from './getOptionName';

test('keeps the given prefix and appends a non empty token', () => {
  expect(getOptionName('metric')).toMatch(/^metric_.+/);
  expect(getOptionName('filter')).toMatch(/^filter_.+/);
});

test('generates unique ids across many generations', () => {
  const ids = new Set(
    Array.from({ length: 10000 }, () => getOptionName('metric')),
  );
  expect(ids.size).toBe(10000);
});

test('falls back to getRandomValues when randomUUID is unavailable', () => {
  const actualCrypto = globalThis.crypto;
  const withoutRandomUUID = {
    getRandomValues: (array: Uint8Array) => actualCrypto.getRandomValues(array),
  } as Crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: withoutRandomUUID,
    configurable: true,
  });
  try {
    const ids = new Set(
      Array.from({ length: 1000 }, () => getOptionName('filter')),
    );
    expect(ids.size).toBe(1000);
    ids.forEach(id => expect(id).toMatch(/^filter_[0-9a-f]{32}$/));
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: actualCrypto,
      configurable: true,
    });
  }
});

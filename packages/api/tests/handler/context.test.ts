/**
 * API Handler - Context Tests (Happy Path)
 *
 * Tests the conversion of framework-specific requests to RequestContext:
 * - Express request conversion
 * - Next.js App Router request conversion
 * - Generic request conversion
 * - Custom extractors (user, params, query)
 * - Auto-detection logic
 */

import { describe, it, expect } from 'vitest';
import {
  buildContext,
  buildContextFromExpress,
  buildContextFromNextApp,
  buildContextFromGeneric,
  isExpressLikeRequest,
  isNextRequest,
} from '../../src/handler/context';
import { apiContextData, createTestData } from '../../../types/src/test/fixtures';
import type { ExpressLikeRequest, GenericHttpRequest } from '../../../types/src/api/handler';

describe('API Handler Context - Happy Path', () => {
  describe('Express Adapter', () => {
    it('should build context from Express GET request', () => {
      const expressRequest = createTestData.expressRequest();

      const context = buildContextFromExpress(expressRequest as ExpressLikeRequest);

      expect(context.method).toBe('GET');
      expect(context.params).toEqual({ id: '1' });
      expect(context.query).toEqual({ status: 'active' });
      expect(context.body).toBeUndefined();
      expect(context.headers?.['content-type']).toBe('application/json');
      expect(context.user).toEqual({ id: 1, role: 'user' });
    });

    it('should build context from Express POST request with body', () => {
      const expressPostRequest = apiContextData.validExpressPostRequest;

      const context = buildContextFromExpress(expressPostRequest as ExpressLikeRequest);

      expect(context.method).toBe('POST');
      expect(context.body).toEqual({ name: 'John Doe', email: 'john@example.com' });
      expect(context.user).toEqual({ id: 1, role: 'admin' });
    });

    it('should normalize headers to lowercase', () => {
      const requestWithMixedCaseHeaders = createTestData.expressRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'value',
          'AUTHORIZATION': 'Bearer token123',
        },
      });

      const context = buildContextFromExpress(requestWithMixedCaseHeaders as ExpressLikeRequest);

      expect(context.headers['content-type']).toBe('application/json');
      expect(context.headers['x-custom-header']).toBe('value');
      expect(context.headers['authorization']).toBe('Bearer token123');
    });

    it('should pick first value from array headers', () => {
      const requestWithArrayHeaders = apiContextData.expressRequestWithArrayHeaders;

      const context = buildContextFromExpress(requestWithArrayHeaders as ExpressLikeRequest);

      expect(context.headers['x-custom']).toBe('value1');
    });

    it('should handle custom metadata', () => {
      const expressRequest = createTestData.expressRequest();
      const customMetadata = { source: 'test-suite', version: '1.0' };

      const context = buildContextFromExpress(expressRequest as ExpressLikeRequest, {
        metadata: customMetadata,
      });

      expect(context.metadata).toEqual(customMetadata);
    });

    it('should use custom user extractor', () => {
      const expressRequest = createTestData.expressRequest({ user: undefined });
      const customUser = { id: 999, role: 'superadmin' };

      const context = buildContextFromExpress(expressRequest as ExpressLikeRequest, {
        extractUser: () => customUser,
      });

      expect(context.user).toEqual(customUser);
    });

    it('should handle missing optional fields gracefully', () => {
      const minimalExpressRequest: ExpressLikeRequest = {
        method: 'GET',
        params: {},
        query: {},
        headers: {},
      };

      const context = buildContextFromExpress(minimalExpressRequest);

      expect(context.method).toBe('GET');
      expect(context.params).toEqual({});
      expect(context.query).toEqual({});
      expect(context.body).toBeUndefined();
      expect(context.user).toBeUndefined();
      expect(context.metadata).toEqual({});
    });

    it('should preserve query params with array values', () => {
      const requestWithArrayQuery = apiContextData.expressRequestMultipleQueryValues;

      const context = buildContextFromExpress(requestWithArrayQuery as ExpressLikeRequest);

      expect(context.query.tags).toEqual(['tech', 'news', 'sports']);
    });
  });

  describe('Next.js App Router Adapter', () => {
    it('should build context from Next.js GET request', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/users?status=active');

      const context = await buildContextFromNextApp(nextRequest);

      expect(context.method).toBe('GET');
      expect(context.query).toEqual({ status: 'active' });
      expect(context.headers['content-type']).toBe('application/json');
      expect(context.body).toBeUndefined();
    });

    it('should build context from Next.js POST request with JSON body', async () => {
      const postBody = { name: 'Jane Doe', email: 'jane@example.com' };
      const nextPostRequest = createTestData.nextRequest('https://example.com/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(postBody),
      });

      const context = await buildContextFromNextApp(nextPostRequest);

      expect(context.method).toBe('POST');
      expect(context.body).toEqual(postBody);
    });

    it('should handle multiple query parameters with same key', async () => {
      const nextRequest = createTestData.nextRequest(
        'https://example.com/api/posts?tag=tech&tag=news&tag=sports'
      );

      const context = await buildContextFromNextApp(nextRequest);

      expect(context.query.tag).toEqual(['tech', 'news', 'sports']);
    });

    it('should handle text body for non-JSON content type', async () => {
      const textBody = 'plain text content';
      const nextRequest = createTestData.nextRequest('https://example.com/api/data', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: textBody,
      });

      const context = await buildContextFromNextApp(nextRequest);

      expect(context.body).toBe(textBody);
    });

    it('should use custom params extractor', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/users/123');
      const customParams = { id: '123', slug: 'test-slug' };

      const context = await buildContextFromNextApp(nextRequest, {
        extractParams: () => customParams,
      });

      expect(context.params).toEqual(customParams);
    });

    it('should use custom user extractor', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/protected');
      const authenticatedUser = { id: 42, username: 'testuser' };

      const context = await buildContextFromNextApp(nextRequest, {
        extractUser: () => authenticatedUser,
      });

      expect(context.user).toEqual(authenticatedUser);
    });

    it('should handle DELETE request without body', async () => {
      const nextDeleteRequest = createTestData.nextRequest('https://example.com/api/users/1', {
        method: 'DELETE',
      });

      const context = await buildContextFromNextApp(nextDeleteRequest);

      expect(context.method).toBe('DELETE');
      expect(context.body).toBeUndefined();
    });

    it('should handle requests with custom metadata', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/data');
      const metadata = { requestId: 'abc123', trace: true };

      const context = await buildContextFromNextApp(nextRequest, { metadata });

      expect(context.metadata).toEqual(metadata);
    });
  });

  describe('Generic HTTP Adapter', () => {
    it('should build context from generic HTTP request', () => {
      const genericRequest: GenericHttpRequest = {
        method: 'GET',
        url: 'https://example.com/api/users?status=active',
        headers: { 'content-type': 'application/json' },
        body: undefined,
      };

      const context = buildContextFromGeneric(genericRequest);

      expect(context.method).toBe('GET');
      expect(context.query).toEqual({ status: 'active' });
      expect(context.headers['content-type']).toBe('application/json');
    });

    it('should handle Headers object', () => {
      const headersObject = new Headers();
      headersObject.set('content-type', 'application/json');
      headersObject.set('authorization', 'Bearer token');

      const genericRequest: GenericHttpRequest = {
        method: 'GET',
        headers: headersObject,
      };

      const context = buildContextFromGeneric(genericRequest);

      expect(context.headers['content-type']).toBe('application/json');
      expect(context.headers['authorization']).toBe('Bearer token');
    });

    it('should use custom query extractor', () => {
      const genericRequest: GenericHttpRequest = {
        method: 'GET',
        headers: {},
      };
      const customQuery = { filter: 'active', limit: '10' };

      const context = buildContextFromGeneric(genericRequest, {
        extractQuery: () => customQuery,
      });

      expect(context.query).toEqual(customQuery);
    });

    it('should handle missing URL gracefully', () => {
      const genericRequest: GenericHttpRequest = {
        method: 'POST',
        headers: {},
        body: { data: 'test' },
      };

      const context = buildContextFromGeneric(genericRequest);

      expect(context.method).toBe('POST');
      expect(context.query).toEqual({});
      expect(context.body).toEqual({ data: 'test' });
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify Express-like request', () => {
      const expressRequest = createTestData.expressRequest();

      expect(isExpressLikeRequest(expressRequest)).toBe(true);
    });

    it('should correctly identify Next.js Request', () => {
      const nextRequest = createTestData.nextRequest('https://example.com/');

      expect(isNextRequest(nextRequest)).toBe(true);
    });

    it('should reject non-request objects in Express type guard', () => {
      expect(isExpressLikeRequest(null)).toBe(false);
      expect(isExpressLikeRequest(undefined)).toBe(false);
      expect(isExpressLikeRequest({})).toBe(false);
      expect(isExpressLikeRequest({ method: 'GET' })).toBe(false);
    });

    it('should reject non-Request objects in Next type guard', () => {
      expect(isNextRequest(null)).toBe(false);
      expect(isNextRequest({})).toBe(false);
      expect(isNextRequest({ method: 'GET' })).toBe(false);
    });
  });

  describe('Auto Detection', () => {
    it('should auto-detect and build context from Express request', async () => {
      const expressRequest = createTestData.expressRequest();

      const context = await buildContext(expressRequest);

      expect(context.method).toBe('GET');
      expect(context.params).toEqual({ id: '1' });
    });

    it('should auto-detect and build context from Next.js request', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/users');

      const context = await buildContext(nextRequest);

      expect(context.method).toBe('GET');
      expect(context.headers['content-type']).toBe('application/json');
    });

    it('should fallback to generic adapter for unknown request types', async () => {
      const unknownRequest = {
        method: 'GET',
        headers: { 'content-type': 'text/plain' },
      };

      const context = await buildContext(unknownRequest);

      expect(context.method).toBe('GET');
    });
  });

  describe('Input Immutability', () => {
    it('should not mutate original Express request', () => {
      const originalRequest = createTestData.expressRequest();
      const requestCopy = JSON.parse(JSON.stringify(originalRequest));

      buildContextFromExpress(originalRequest as ExpressLikeRequest);

      expect(originalRequest).toEqual(requestCopy);
    });

    it('should not mutate custom metadata options', () => {
      const originalMetadata = { source: 'test', version: 1 };
      const metadataCopy = { ...originalMetadata };
      const expressRequest = createTestData.expressRequest();

      buildContextFromExpress(expressRequest as ExpressLikeRequest, {
        metadata: originalMetadata,
      });

      expect(originalMetadata).toEqual(metadataCopy);
    });
  });

  describe('Determinism', () => {
    it('should produce identical context for identical Express requests', () => {
      const request1 = createTestData.expressRequest();
      const request2 = createTestData.expressRequest();

      const context1 = buildContextFromExpress(request1 as ExpressLikeRequest);
      const context2 = buildContextFromExpress(request2 as ExpressLikeRequest);

      expect(context1).toEqual(context2);
    });

    it('should produce identical context for identical Next.js requests', async () => {
      const request1 = createTestData.nextRequest('https://example.com/api/test?foo=bar');
      const request2 = createTestData.nextRequest('https://example.com/api/test?foo=bar');

      const context1 = await buildContextFromNextApp(request1);
      const context2 = await buildContextFromNextApp(request2);

      expect(context1).toEqual(context2);
    });
  });
});

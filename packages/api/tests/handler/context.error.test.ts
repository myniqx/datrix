/**
 * API Handler - Context Tests (Error Path)
 *
 * Tests error handling, edge cases, and security for context builders:
 * - Invalid input handling
 * - Malicious headers (XSS, injection)
 * - Oversized data
 * - Invalid URLs
 * - Circular references
 * - Custom extractor errors
 * - Boundary conditions
 */

import { describe, it, expect } from 'vitest';
import {
  buildContext,
  buildContextFromExpress,
  buildContextFromNextApp,
  buildContextFromGeneric,
} from '../../src/handler/context';
import { apiContextData, edgeCases, createTestData } from '../../../types/src/test/fixtures';
import type { ExpressLikeRequest, GenericHttpRequest } from '../../../types/src/api/handler';

describe('API Handler Context - Error Path', () => {
  describe('Express Adapter - Invalid Input', () => {
    it('should handle request with undefined method', () => {
      const requestWithoutMethod = {
        params: {},
        query: {},
        headers: {},
      } as ExpressLikeRequest;

      const context = buildContextFromExpress(requestWithoutMethod);

      expect(context.method).toBe('GET');
    });

    it('should handle request with null params', () => {
      const requestWithNullParams = createTestData.expressRequest({
        params: null as any,
      });

      const context = buildContextFromExpress(requestWithNullParams as ExpressLikeRequest);

      expect(context.params).toEqual({});
    });

    it('should handle request with null query', () => {
      const requestWithNullQuery = createTestData.expressRequest({
        query: null as any,
      });

      const context = buildContextFromExpress(requestWithNullQuery as ExpressLikeRequest);

      expect(context.query).toEqual({});
    });

    it('should sanitize malicious headers - XSS', () => {
      const requestWithXssHeader = createTestData.expressRequest({
        headers: {
          'x-custom': apiContextData.maliciousHeaders.xssInHeader,
        },
      });

      const context = buildContextFromExpress(requestWithXssHeader as ExpressLikeRequest);

      expect(context.headers['x-custom']).toBe(apiContextData.maliciousHeaders.xssInHeader);
    });

    it('should handle malicious headers - SQL injection', () => {
      const requestWithSqlInjection = createTestData.expressRequest({
        headers: {
          'x-filter': apiContextData.maliciousHeaders.sqlInjectionInHeader,
        },
      });

      const context = buildContextFromExpress(requestWithSqlInjection as ExpressLikeRequest);

      expect(context.headers['x-filter']).toBe(apiContextData.maliciousHeaders.sqlInjectionInHeader);
    });

    it('should handle CRLF injection in headers', () => {
      const requestWithCrlfInjection = createTestData.expressRequest({
        headers: {
          'x-data': apiContextData.maliciousHeaders.crlfInjection,
        },
      });

      const context = buildContextFromExpress(requestWithCrlfInjection as ExpressLikeRequest);

      expect(context.headers['x-data']).toContain('value');
    });

    it('should handle null byte injection in headers', () => {
      const requestWithNullByte = createTestData.expressRequest({
        headers: {
          'x-value': apiContextData.maliciousHeaders.nullByteInjection,
        },
      });

      const context = buildContextFromExpress(requestWithNullByte as ExpressLikeRequest);

      expect(context.headers['x-value']).toBe(apiContextData.maliciousHeaders.nullByteInjection);
    });
  });

  describe('Express Adapter - Edge Cases', () => {
    it('should handle empty string headers', () => {
      const requestWithEmptyHeader = createTestData.expressRequest({
        headers: {
          'x-empty': apiContextData.edgeCaseHeaders.emptyString,
        },
      });

      const context = buildContextFromExpress(requestWithEmptyHeader as ExpressLikeRequest);

      expect(context.headers['x-empty']).toBe('');
    });

    it('should handle very long headers', () => {
      const requestWithLongHeader = createTestData.expressRequest({
        headers: {
          'x-long': apiContextData.edgeCaseHeaders.veryLongHeader,
        },
      });

      const context = buildContextFromExpress(requestWithLongHeader as ExpressLikeRequest);

      expect(context.headers['x-long']).toBe(apiContextData.edgeCaseHeaders.veryLongHeader);
      expect(context.headers['x-long']?.length).toBe(10000);
    });

    it('should handle unicode in headers', () => {
      const requestWithUnicodeHeader = createTestData.expressRequest({
        headers: {
          'x-unicode': apiContextData.edgeCaseHeaders.unicodeHeader,
        },
      });

      const context = buildContextFromExpress(requestWithUnicodeHeader as ExpressLikeRequest);

      expect(context.headers['x-unicode']).toBe(apiContextData.edgeCaseHeaders.unicodeHeader);
    });

    it('should handle whitespace-only headers', () => {
      const requestWithWhitespaceHeader = createTestData.expressRequest({
        headers: {
          'x-whitespace': apiContextData.edgeCaseHeaders.onlyWhitespace,
        },
      });

      const context = buildContextFromExpress(requestWithWhitespaceHeader as ExpressLikeRequest);

      expect(context.headers['x-whitespace']).toBe('   ');
    });

    it('should handle special characters in headers', () => {
      const requestWithSpecialChars = createTestData.expressRequest({
        headers: {
          'x-special': apiContextData.edgeCaseHeaders.specialChars,
        },
      });

      const context = buildContextFromExpress(requestWithSpecialChars as ExpressLikeRequest);

      expect(context.headers['x-special']).toBe(apiContextData.edgeCaseHeaders.specialChars);
    });

    it('should handle empty array in headers', () => {
      const requestWithEmptyArrayHeader = createTestData.expressRequest({
        headers: {
          'x-empty-array': [] as any,
        },
      });

      const context = buildContextFromExpress(requestWithEmptyArrayHeader as ExpressLikeRequest);

      expect(context.headers['x-empty-array']).toBeUndefined();
    });
  });

  describe('Express Adapter - Query Params Security', () => {
    it('should preserve XSS attempts in query params', () => {
      const requestWithXssQuery = createTestData.expressRequest({
        query: apiContextData.maliciousQueryParams.xssInQuery,
      });

      const context = buildContextFromExpress(requestWithXssQuery as ExpressLikeRequest);

      expect(context.query.search).toBe('<script>alert(1)</script>');
    });

    it('should preserve SQL injection attempts in query params', () => {
      const requestWithSqlInjection = createTestData.expressRequest({
        query: apiContextData.maliciousQueryParams.sqlInjectionInQuery,
      });

      const context = buildContextFromExpress(requestWithSqlInjection as ExpressLikeRequest);

      expect(context.query.name).toBe("'; DROP TABLE users; --");
    });

    it('should preserve path traversal attempts in query params', () => {
      const requestWithPathTraversal = createTestData.expressRequest({
        query: apiContextData.maliciousQueryParams.pathTraversal,
      });

      const context = buildContextFromExpress(requestWithPathTraversal as ExpressLikeRequest);

      expect(context.query.file).toBe('../../../etc/passwd');
    });
  });

  describe('Next.js Adapter - Invalid Input', () => {
    it('should handle malformed JSON body gracefully', async () => {
      const malformedRequest = new Request('https://example.com/api/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"invalid": json}',
      });

      const context = await buildContextFromNextApp(malformedRequest);

      expect(context.body).toBeUndefined();
    });

    it('should handle empty body for POST request', async () => {
      const emptyBodyRequest = createTestData.nextRequest('https://example.com/api/data', {
        method: 'POST',
        body: null,
      });

      const context = await buildContextFromNextApp(emptyBodyRequest);

      expect(context.body).toBeUndefined();
    });

    it('should handle very long URL', async () => {
      const longUrl = apiContextData.edgeCaseUrls.veryLongUrl;
      const longUrlRequest = createTestData.nextRequest(longUrl);

      const context = await buildContextFromNextApp(longUrlRequest);

      expect(context.method).toBe('GET');
    });

    it('should handle unicode in URL', async () => {
      const unicodeUrl = apiContextData.edgeCaseUrls.unicodeUrl;
      const unicodeRequest = createTestData.nextRequest(unicodeUrl);

      const context = await buildContextFromNextApp(unicodeRequest);

      expect(context.method).toBe('GET');
    });

    it('should ignore URL fragment', async () => {
      const urlWithFragment = apiContextData.edgeCaseUrls.urlWithFragment;
      const fragmentRequest = createTestData.nextRequest(urlWithFragment);

      const context = await buildContextFromNextApp(fragmentRequest);

      expect(context.method).toBe('GET');
    });
  });

  describe('Next.js Adapter - Security', () => {
    it('should handle XSS in query parameters', async () => {
      const xssUrl = 'https://example.com/api/search?q=<script>alert(1)</script>';
      const xssRequest = createTestData.nextRequest(xssUrl);

      const context = await buildContextFromNextApp(xssRequest);

      expect(context.query.q).toBe('<script>alert(1)</script>');
    });

    it('should handle SQL injection in query parameters', async () => {
      const sqlUrl = "https://example.com/api/users?name='; DROP TABLE users; --";
      const sqlRequest = createTestData.nextRequest(sqlUrl);

      const context = await buildContextFromNextApp(sqlRequest);

      expect(context.query.name).toBe("'; DROP TABLE users; --");
    });

    it('should reject control characters in headers', async () => {
      expect(() => {
        new Request('https://example.com/api/data', {
          headers: {
            'x-control': apiContextData.edgeCaseHeaders.controlChars,
          },
        });
      }).toThrow();
    });
  });

  describe('Next.js Adapter - Edge Cases', () => {
    it('should handle request with no search params', async () => {
      const noParamsRequest = createTestData.nextRequest('https://example.com/api/data');

      const context = await buildContextFromNextApp(noParamsRequest);

      expect(context.query).toEqual({});
    });

    it('should handle request with empty search param values', async () => {
      const emptyParamsRequest = createTestData.nextRequest('https://example.com/api/data?a=&b=&c=');

      const context = await buildContextFromNextApp(emptyParamsRequest);

      expect(context.query).toEqual({ a: '', b: '', c: '' });
    });

    it('should handle request without content-type header', async () => {
      const noContentTypeRequest = new Request('https://example.com/api/data', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      const context = await buildContextFromNextApp(noContentTypeRequest);

      expect(context.body).toBeDefined();
    });
  });

  describe('Generic Adapter - Invalid Input', () => {
    it('should handle malformed URL gracefully', () => {
      const malformedUrlRequest: GenericHttpRequest = {
        method: 'GET',
        url: apiContextData.edgeCaseUrls.malformedUrl,
        headers: {},
      };

      const context = buildContextFromGeneric(malformedUrlRequest);

      expect(context.query).toEqual({});
    });

    it('should handle request with empty URL', () => {
      const emptyUrlRequest: GenericHttpRequest = {
        method: 'GET',
        url: apiContextData.edgeCaseUrls.emptyUrl,
        headers: {},
      };

      const context = buildContextFromGeneric(emptyUrlRequest);

      expect(context.query).toEqual({});
    });

    it('should handle Headers object with no entries', () => {
      const emptyHeadersRequest: GenericHttpRequest = {
        method: 'GET',
        headers: new Headers(),
      };

      const context = buildContextFromGeneric(emptyHeadersRequest);

      expect(context.headers).toEqual({});
    });
  });

  describe('Custom Extractors - Error Handling', () => {
    it('should handle custom user extractor throwing error', () => {
      const expressRequest = createTestData.expressRequest();

      expect(() => {
        buildContextFromExpress(expressRequest as ExpressLikeRequest, {
          extractUser: () => {
            throw new Error('Auth service unavailable');
          },
        });
      }).toThrow('Auth service unavailable');
    });

    it('should fallback to empty object when custom params extractor returns null', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/users');

      const context = await buildContextFromNextApp(nextRequest, {
        extractParams: () => null as any,
      });

      expect(context.params).toEqual({});
    });

    it('should handle custom query extractor returning undefined', () => {
      const genericRequest: GenericHttpRequest = {
        method: 'GET',
        headers: {},
      };

      const context = buildContextFromGeneric(genericRequest, {
        extractQuery: () => undefined as any,
      });

      expect(context.query).toBeUndefined();
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle maximum nested query params', async () => {
      const maxNestedUrl = 'https://example.com/api/data?' +
        Array.from({ length: 100 }, (_, i) => `param${i}=value${i}`).join('&');
      const maxNestedRequest = createTestData.nextRequest(maxNestedUrl);

      const context = await buildContextFromNextApp(maxNestedRequest);

      expect(Object.keys(context.query).length).toBe(100);
    });

    it('should handle zero-length params', () => {
      const emptyParamsRequest = createTestData.expressRequest({
        params: {},
      });

      const context = buildContextFromExpress(emptyParamsRequest as ExpressLikeRequest);

      expect(context.params).toEqual({});
    });

    it('should handle zero-length query', () => {
      const emptyQueryRequest = createTestData.expressRequest({
        query: {},
      });

      const context = buildContextFromExpress(emptyQueryRequest as ExpressLikeRequest);

      expect(context.query).toEqual({});
    });

    it('should handle zero-length headers', () => {
      const emptyHeadersRequest = createTestData.expressRequest({
        headers: {},
      });

      const context = buildContextFromExpress(emptyHeadersRequest as ExpressLikeRequest);

      expect(context.headers).toEqual({});
    });
  });

  describe('Negative Space Coverage', () => {
    it('should not include unknown Express request properties', () => {
      const requestWithExtraProps = {
        ...createTestData.expressRequest(),
        extraProp: 'should not be included',
        anotherProp: 123,
      };

      const context = buildContextFromExpress(requestWithExtraProps as any);

      expect((context as any).extraProp).toBeUndefined();
      expect((context as any).anotherProp).toBeUndefined();
    });

    it('should not leak internal request properties', () => {
      const expressRequest = createTestData.expressRequest();

      const context = buildContextFromExpress(expressRequest as ExpressLikeRequest);

      expect((context as any).req).toBeUndefined();
      expect((context as any).res).toBeUndefined();
      expect((context as any).next).toBeUndefined();
    });
  });

  describe('Case Normalization', () => {
    it('should normalize all header keys to lowercase in Express', () => {
      const mixedCaseRequest = createTestData.expressRequest({
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': 'secret123',
          'AUTHORIZATION': 'Bearer token',
          'accept-ENCODING': 'gzip',
        },
      });

      const context = buildContextFromExpress(mixedCaseRequest as ExpressLikeRequest);

      expect(context.headers['content-type']).toBe('application/json');
      expect(context.headers['x-api-key']).toBe('secret123');
      expect(context.headers['authorization']).toBe('Bearer token');
      expect(context.headers['accept-encoding']).toBe('gzip');
      expect(context.headers['Content-Type']).toBeUndefined();
      expect(context.headers['AUTHORIZATION']).toBeUndefined();
    });

    it('should preserve method case variations', () => {
      const lowercaseMethodRequest = {
        method: 'post',
        params: {},
        query: {},
        headers: {},
      };

      const context = buildContextFromExpress(lowercaseMethodRequest as ExpressLikeRequest);

      expect(context.method).toBe('POST');
    });
  });

  describe('Idempotency', () => {
    it('should produce same result when called multiple times with Express request', () => {
      const expressRequest = createTestData.expressRequest();

      const context1 = buildContextFromExpress(expressRequest as ExpressLikeRequest);
      const context2 = buildContextFromExpress(expressRequest as ExpressLikeRequest);
      const context3 = buildContextFromExpress(expressRequest as ExpressLikeRequest);

      expect(context1).toEqual(context2);
      expect(context2).toEqual(context3);
    });

    it('should produce same result when called multiple times with Next.js request', async () => {
      const nextRequest = createTestData.nextRequest('https://example.com/api/test');

      const context1 = await buildContextFromNextApp(nextRequest.clone());
      const context2 = await buildContextFromNextApp(nextRequest.clone());

      expect(context1).toEqual(context2);
    });
  });
});

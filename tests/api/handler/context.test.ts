/**
 * API Handler - Context Tests
 *
 * Tests the conversion of framework-specific requests to RequestContext:
 * - Express request conversion
 * - Next.js App Router request conversion
 * - Custom extractors (user, params, query)
 * - Auto-detection logic
 */

import { describe, it, expect } from 'vitest';
import {
  buildContextFromExpress,
  buildContextFromNextApp,
  buildContext,
  ExpressLikeRequest
} from '@api/handler/context';

describe('API Handler - Context', () => {
  describe('Express Adapter', () => {
    it('should build context from Express request', () => {
      const mockReq: ExpressLikeRequest = {
        method: 'POST',
        url: '/api/users/1?active=true',
        params: { id: '1' },
        query: { active: 'true' },
        body: { name: 'John' },
        headers: {
          'Content-Type': 'application/json',
          'X-Custom': ['val1', 'val2']
        },
        user: { id: 123, role: 'admin' }
      };

      const context = buildContextFromExpress(mockReq);

      expect(context.method).toBe('POST');
      expect(context.params).toEqual({ id: '1' });
      expect(context.query).toEqual({ active: 'true' });
      expect(context.body).toEqual({ name: 'John' });
      expect(context.headers['content-type']).toBe('application/json');
      expect(context.headers['x-custom']).toBe('val1'); // Picks first
      expect(context.user).toEqual({ id: 123, role: 'admin' });
    });

    it('should use custom metadata', () => {
      const mockReq: any = { method: 'GET', params: {}, query: {}, headers: {} };
      const context = buildContextFromExpress(mockReq, { metadata: { source: 'test' } });
      expect(context.metadata).toEqual({ source: 'test' });
    });
  });

  describe('Next.js App Router Adapter', () => {
    it('should build context from Request object', async () => {
      const request = new Request('https://example.com/api/users?status=active&status=pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Jane' })
      });

      const context = await buildContextFromNextApp(request);

      expect(context.method).toBe('POST');
      expect(context.query).toEqual({ status: ['active', 'pending'] });
      expect(context.body).toEqual({ name: 'Jane' });
      expect(context.headers['content-type']).toBe('application/json');
    });

    it('should handle custom extractors in Next.js', async () => {
      const request = new Request('https://example.com/api/users/1');
      const options = {
        extractParams: () => ({ id: '1' }),
        extractUser: () => ({ name: 'AuthUser' })
      };

      const context = await buildContextFromNextApp(request, options);

      expect(context.params).toEqual({ id: '1' });
      expect(context.user).toEqual({ name: 'AuthUser' });
    });
  });

  describe('Auto Detection', () => {
    it('should detect Express-like requests', async () => {
      const mockReq = {
        method: 'GET',
        params: { id: '1' },
        query: {},
        headers: {}
      };

      const context = await buildContext(mockReq);
      expect(context.params).toEqual({ id: '1' });
    });

    it('should detect Next.js Request objects', async () => {
      const request = new Request('https://example.com/');
      const context = await buildContext(request);
      expect(context.method).toBe('GET');
    });
  });
});

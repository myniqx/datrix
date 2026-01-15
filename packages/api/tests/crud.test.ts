/**
 * CRUD Integration Tests
 *
 * Tests the full stack: JsonAdapter + ApiPlugin + handleRequest
 * WITHOUT authentication
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Forja } from 'forja-core';
import { handleRequest } from '../src/helper';
import { createTestConfig, getTmpDir, testSchemas } from './data';
import { serializeQuery } from '../src/serializer/query';
import fs from 'node:fs/promises';

describe('API CRUD Integration Tests', () => {
  let forja: Forja;
  let getForja: () => Promise<Forja>;
  const tmpDir = getTmpDir();

  beforeAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
    // Create temporary directory
    await fs.mkdir(tmpDir, { recursive: true });

    // Get Forja factory function
    getForja = createTestConfig(tmpDir);

    // Get Forja instance (this will initialize everything)
    forja = await getForja();

    // Create tables manually for JsonAdapter
    const adapter = forja.getAdapter();
    for (const schema of forja.getSchemas().getAll()) {
      const result = await adapter.createTable(schema);
      if (!result.success) {
        throw new Error(`Failed to create table ${schema.name}: ${result.error.message}`);
      }
    }
  });

  afterAll(async () => {
    // Disconnect
    if (forja) {
      //     await forja.disconnect();
    }

    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up temp directory:', error);
    }
  });

  describe('CREATE Operation', () => {
    it('should create a new category', async () => {
      const request = new Request('http://localhost:3000/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Electronics',
          description: 'Electronic devices and gadgets',
          isActive: true,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data.name).toBe('Electronics');
      expect(data.data.description).toBe('Electronic devices and gadgets');
      expect(data.data.isActive).toBe(true);
    });

    it('should create a new supplier', async () => {
      const request = new Request('http://localhost:3000/api/suppliers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'TechCorp Inc.',
          email: 'contact@techcorp.com',
          country: 'USA',
          rating: 4.5,
          isVerified: true,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data.name).toBe('TechCorp Inc.');
      expect(data.data.email).toBe('contact@techcorp.com');
      expect(data.data.country).toBe('USA');
      expect(data.data.rating).toBe(4.5);
      expect(data.data.isVerified).toBe(true);
    });

    it('should create a new product with relations', async () => {
      const request = new Request('http://localhost:3000/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Wireless Mouse',
          description: 'Ergonomic wireless mouse with 2.4GHz connectivity',
          price: 29.99,
          stock: 150,
          categoryId: 1,
          supplierId: 1,
          sku: 'WM-2024-001',
          isAvailable: true,
          tags: ['wireless', 'computer', 'accessories'],
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data.name).toBe('Wireless Mouse');
      expect(data.data.price).toBe(29.99);
      expect(data.data.stock).toBe(150);
      expect(data.data.categoryId).toBe(1);
      expect(data.data.supplierId).toBe(1);
      expect(data.data.sku).toBe('WM-2024-001');
      expect(data.data.tags).toEqual(['wireless', 'computer', 'accessories']);
    });

    it('should fail to create product with invalid data (missing required field)', async () => {
      const request = new Request('http://localhost:3000/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: 'Product without name',
          price: 10.00,
          stock: 5,
        }),
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error');
    });

    it('should fail to create category with duplicate name', async () => {
      // First create
      const request1 = new Request('http://localhost:3000/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Unique Category',
          description: 'First creation',
        }),
      });

      const response1 = await handleRequest(forja, request1);
      expect(response1.status).toBe(201);

      // Try duplicate
      const request2 = new Request('http://localhost:3000/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Unique Category',
          description: 'Duplicate attempt',
        }),
      });

      const response2 = await handleRequest(forja, request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(400);
      expect(data2).toHaveProperty('error');
    });
  });

  describe('COMPLEX QUERY Operations', () => {
    beforeAll(async () => {
      await handleRequest(forja, new Request('http://localhost:3000/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Books',
          description: 'Books and literature',
          isActive: true,
        }),
      }));

      await handleRequest(forja, new Request('http://localhost:3000/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'BookCorp Ltd.',
          email: 'info@bookcorp.com',
          country: 'UK',
          rating: 4.8,
          isVerified: true,
        }),
      }));

      const products = [
        {
          name: 'TypeScript Handbook',
          description: 'Complete guide to TypeScript',
          price: 45.00,
          stock: 20,
          categoryId: 3,
          supplierId: 2,
          sku: 'BOOK-TS-001',
          isAvailable: true,
          tags: ['programming', 'typescript', 'book'],
        },
        {
          name: 'Mechanical Keyboard',
          description: 'RGB mechanical keyboard',
          price: 120.00,
          stock: 5,
          categoryId: 1,
          supplierId: 1,
          sku: 'KB-MECH-001',
          isAvailable: true,
          tags: ['gaming', 'keyboard', 'rgb'],
        },
        {
          name: 'USB Cable',
          description: 'USB-C to USB-C cable 2m',
          price: 15.00,
          stock: 200,
          categoryId: 1,
          supplierId: 1,
          sku: 'CABLE-USBC-001',
          isAvailable: true,
          tags: ['cable', 'usb', 'accessories'],
        },
        {
          name: 'JavaScript Guide',
          description: 'Modern JavaScript programming',
          price: 38.00,
          stock: 15,
          categoryId: 3,
          supplierId: 2,
          sku: 'BOOK-JS-001',
          isAvailable: false,
          tags: ['programming', 'javascript', 'book'],
        },
      ];

      for (const product of products) {
        await handleRequest(forja, new Request('http://localhost:3000/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        }));
      }
    });

    it('should query products with AND/OR conditions', async () => {
      const query = {
        where: {
          $or: [
            {
              $and: [
                { price: { $gte: 100 } },
                { stock: { $lte: 10 } }
              ]
            },
            {
              $and: [
                { price: { $lte: 20 } },
                { stock: { $gte: 100 } }
              ]
            }
          ]
        }
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(serialized as Record<string, string>);

      const request = new Request(`http://localhost:3000/api/products?${queryParams}`, {
        method: 'GET',
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(2);

      for (const product of data.data) {
        const matchesFirstCondition = product.price >= 100 && product.stock <= 10;
        const matchesSecondCondition = product.price <= 20 && product.stock >= 100;
        expect(matchesFirstCondition || matchesSecondCondition).toBe(true);
      }
    });
  });

  describe('POPULATE Operations', () => {
    let testProductId: number;

    beforeAll(async () => {
      // Create test data for populate tests
      const categoryResponse = await handleRequest(forja, new Request('http://localhost:3000/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gaming',
          description: 'Gaming peripherals and accessories',
          isActive: true,
        }),
      }));
      const categoryData = await categoryResponse.json();
      const categoryId = categoryData.data.id;

      const supplierResponse = await handleRequest(forja, new Request('http://localhost:3000/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'GameSupply Co.',
          email: 'sales@gamesupply.com',
          country: 'Japan',
          rating: 4.9,
          isVerified: true,
        }),
      }));
      const supplierData = await supplierResponse.json();
      const supplierId = supplierData.data.id;

      // Create a product for populate tests
      const productResponse = await handleRequest(forja, new Request('http://localhost:3000/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gaming Headset',
          description: '7.1 Surround Sound Gaming Headset',
          price: 89.99,
          stock: 50,
          categoryId,
          supplierId,
          sku: 'GH-PRO-001',
          isAvailable: true,
          tags: ['gaming', 'audio', 'headset'],
        }),
      }));

      const productData = await productResponse.json();
      if (!productData.data || !productData.data.id) {
        throw new Error('Failed to create test product for populate tests');
      }
      testProductId = productData.data.id;
    });

    it('should populate with selected fields (Level 1 - 3 fields)', async () => {
      const query = {
        populate: {
          category: {
            select: ['id', 'name', 'description']
          }
        }
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(serialized as Record<string, string>);

      const request = new Request(`http://localhost:3000/api/products/${testProductId}?${queryParams}`, {
        method: 'GET',
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');
      console.log(data.data);
      expect(data.data).toHaveProperty('category');
      expect(data.data.category).toHaveProperty('id');
      expect(data.data.category).toHaveProperty('name');
      expect(data.data.category).toHaveProperty('description');
      expect(data.data.category).not.toHaveProperty('isActive');
      expect(data.data.category).not.toHaveProperty('createdAt');
    });

    it('should populate nested relations (Level 2 - full first level, 3 fields second level)', async () => {
      const query = {
        populate: {
          category: {
            select: '*'
          },
          supplier: {
            select: ['id', 'name', 'country']
          }
        }
      };

      const serialized = serializeQuery(query);
      const queryParams = new URLSearchParams(serialized as Record<string, string>);

      const request = new Request(`http://localhost:3000/api/products/${testProductId}?${queryParams}`, {
        method: 'GET',
      });

      const response = await handleRequest(forja, request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');

      expect(data.data).toHaveProperty('category');
      expect(data.data.category).toHaveProperty('id');
      expect(data.data.category).toHaveProperty('name');
      expect(data.data.category).toHaveProperty('description');
      expect(data.data.category).toHaveProperty('isActive');
      //expect(data.data.category).toHaveProperty('createdAt');

      expect(data.data).toHaveProperty('supplier');
      expect(data.data.supplier).toHaveProperty('id');
      expect(data.data.supplier).toHaveProperty('name');
      expect(data.data.supplier).toHaveProperty('country');
      expect(data.data.supplier).not.toHaveProperty('email');
      expect(data.data.supplier).not.toHaveProperty('rating');
      expect(data.data.supplier).not.toHaveProperty('isVerified');
    });
  });
});

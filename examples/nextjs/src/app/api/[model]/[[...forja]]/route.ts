import { createHandlers } from 'forja-api';
import { buildContextFromNextApp } from 'forja-api/handler';

import { NextRequest } from 'next/server';
import config from '../../../../../forja.config';

async function getHandlers(params: any) {
  const resolvedParams = await params;
  const model = resolvedParams.model;

  // Plural to singular: users -> User, topics -> Topic
  const schemaName = model.charAt(0).toUpperCase() + model.slice(1, -1);
  const schema = config.schemas.find(s => s.name === schemaName);

  if (!schema) return null;

  return createHandlers({
    schema,
    adapter: config.adapter,
    permissions: { read: undefined, create: undefined, update: undefined, delete: undefined }, // Open for example
  });
}

export async function GET(request: NextRequest, { params }: any) {
  const handlers = await getHandlers(params);
  if (!handlers) return new Response('Model not found', { status: 404 });

  const context = await buildContextFromNextApp(request, await params);
  const response = await handlers.GET(context);
  return Response.json(response.body, { status: response.status });
}

export async function POST(request: NextRequest, { params }: any) {
  const handlers = await getHandlers(params);
  if (!handlers) return new Response('Model not found', { status: 404 });

  const context = await buildContextFromNextApp(request, await params);
  const response = await handlers.POST(context);
  return Response.json(response.body, { status: response.status });
}

export async function PATCH(request: NextRequest, { params }: any) {
  const handlers = await getHandlers(params);
  if (!handlers) return new Response('Model not found', { status: 404 });

  const context = await buildContextFromNextApp(request, await params);
  const response = await handlers.PATCH(context);
  return Response.json(response.body, { status: response.status });
}

export async function DELETE(request: NextRequest, { params }: any) {
  const handlers = await getHandlers(params);
  if (!handlers) return new Response('Model not found', { status: 404 });

  const context = await buildContextFromNextApp(request, await params);
  const response = await handlers.DELETE(context);
  return Response.json(response.body, { status: response.status });
}

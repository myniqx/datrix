import { handleGet, handlePost, handlePatch, handleDelete } from 'forja-api';

// Import config to register it with Forja
import '../../../../../forja.config';

export const GET = handleGet;
export const POST = handlePost;
export const PATCH = handlePatch;
export const DELETE = handleDelete;

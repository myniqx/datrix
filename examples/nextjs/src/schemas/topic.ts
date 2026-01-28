import { ForjaEntry } from 'forja-types';
import type { User } from './user';
import type { Comment } from './comment';
import type { Like } from './like';

export interface Topic extends ForjaEntry {
  title: string;
  content: string;

  author: User;
  authorId: string;

  comments?: Comment[];
  likes?: Like[];
}

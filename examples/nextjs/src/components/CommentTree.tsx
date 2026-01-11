'use client';

import { useForja } from '../hooks/useForja';
import { generateFakeComment } from '../utils/faker';
import { useState } from 'react';

interface CommentTreeProps {
  comments: any[];
  topicId: string;
  users: any[];
  onUpdate: () => void;
  parentId?: string;
}

export default function CommentTree({ comments, topicId, users, onUpdate, parentId }: CommentTreeProps) {
  const { create: createComment } = useForja('Comment');
  const { create: createLike, remove: removeLike, data: likes, fetchAll: fetchLikes } = useForja('Like');
  const [commentSort, setCommentSort] = useState<'new' | 'popular'>('new');

  const sortedComments = [...comments].sort((a, b) => {
    if (commentSort === 'new') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    const aLikes = a.likes?.length || 0;
    const bLikes = b.likes?.length || 0;
    return bLikes - aLikes;
  });

  const handleReply = async (pId: string) => {
    if (users.length === 0) return;
    const randomAuthor = users[Math.floor(Math.random() * users.length)];
    await createComment(generateFakeComment(topicId, randomAuthor.id, pId));
    onUpdate();
  };

  const handleToggleLike = async (comment: any) => {
    if (users.length === 0) return;
    const activeUser = users[0]; // Assume first user is active for simplicity

    const existingLike = comment.likes?.find((l: any) => l.userId === activeUser.id);

    if (existingLike) {
      await removeLike(existingLike.id);
    } else {
      await createLike({ userId: activeUser.id, commentId: comment.id });
    }
    onUpdate();
  };

  return (
    <div className="space-y-4">
      {parentId === undefined && (
        <div className="flex justify-end gap-2 mb-2">
          <button
            onClick={() => setCommentSort('new')}
            className={`text-xs px-2 py-1 rounded ${commentSort === 'new' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500'}`}
          >
            Newest
          </button>
          <button
            onClick={() => setCommentSort('popular')}
            className={`text-xs px-2 py-1 rounded ${commentSort === 'popular' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500'}`}
          >
            Highest Rated
          </button>
        </div>
      )}

      {sortedComments.map((comment: any) => (
        <div key={comment.id} className={`pl-4 border-l-2 ${parentId ? 'border-slate-100' : 'border-slate-200'} py-2`}>
          <div className="bg-slate-50 p-3 rounded-lg group">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-bold text-slate-700">{comment.author?.displayName}</span>
              <span className="text-[10px] text-slate-400">{new Date(comment.createdAt).toLocaleTimeString()}</span>
            </div>
            <p className="text-sm text-slate-600 mb-3">{comment.content}</p>

            <div className="flex items-center gap-4 opacity-70 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleToggleLike(comment)}
                className="flex items-center gap-1 text-[11px] font-semibold hover:text-red-500 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${comment.likes?.length > 0 ? 'fill-red-500 text-red-500' : 'text-slate-400'}`} viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                </svg>
                {comment.likes?.length || 0}
              </button>

              <button
                onClick={() => handleReply(comment.id)}
                className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                Reply
              </button>
            </div>
          </div>

          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-4">
              <CommentTree
                comments={comment.replies}
                topicId={topicId}
                users={users}
                onUpdate={onUpdate}
                parentId={comment.id}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

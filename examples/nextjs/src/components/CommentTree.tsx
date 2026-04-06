"use client";

import { useDatrix } from "../hooks/useDatrix";
import { generateFakeComment } from "../utils/faker";
import { useState } from "react";
import type {
	Comment,
	User,
	Like,
	CreateLikeInput,
	UpdateLikeInput,
	CreateCommentInput,
	UpdateCommentInput,
} from "../../types/generated";
import { OrderByItem } from "@datrix/core";

interface CommentTreeProps {
	comments: Comment[];
	topicId: number;
	users: User[];
	parentId?: number;
}

export default function CommentTree({
	comments: initialComments,
	topicId,
	users,
	parentId,
}: CommentTreeProps) {
	const { create: createComment } = useDatrix<
		Comment,
		CreateCommentInput,
		UpdateCommentInput
	>("comment");
	const { create: createLike, remove: removeLike } = useDatrix<
		Like,
		CreateLikeInput,
		UpdateLikeInput
	>("like", undefined, { invalidateModels: ["comment"] });
	const [commentSort, setCommentSort] = useState<"new" | "popular">("new");
	const [searchTerm, setSearchTerm] = useState("");

	const isRoot = parentId === undefined;

	const commentQuery = isRoot
		? {
				where: {
					topic: { id: { $eq: topicId } },
					...(searchTerm.trim() && {
						$or: [
							{ content: { $contains: searchTerm } },
							{ author: { name: { $contains: searchTerm } } },
						],
					}),
				},
				populate: {
					author: true,
					replies: {
						populate: { author: true, likes: { populate: { user: true } } },
					},
					likes: { populate: { user: true } },
				},
				orderBy: [
					{
						field: commentSort === "new" ? "createdAt" : "likesCount",
						direction: "desc" as const,
					} satisfies OrderByItem<Comment>,
				],
			}
		: undefined;

	const { data: fetchedComments, isLoading: searching } = useDatrix<
		Comment,
		CreateCommentInput,
		UpdateCommentInput
	>("comment", commentQuery!);
	const comments = isRoot ? fetchedComments : initialComments;

	const handleReply = async (pId: number) => {
		if (users.length === 0) return;
		const randomAuthor = users[Math.floor(Math.random() * users.length)];
		await createComment(generateFakeComment(topicId, randomAuthor.id, pId));
	};

	const handleToggleLike = async (comment: Comment) => {
		if (users.length === 0) return;
		const activeUser = users[0];

		const existingLike = comment.likes?.find(
			(l) => l.user?.id === activeUser.id,
		);

		if (existingLike) {
			await removeLike(existingLike.id);
		} else {
			await createLike({ user: activeUser.id, comment: comment.id });
		}
	};

	return (
		<div className="space-y-4">
			{isRoot && (
				<div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
					<div className="relative flex-1">
						<input
							type="text"
							placeholder="Search in comments or authors..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
						/>
						<svg
							className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
						{searching && (
							<div className="absolute right-3 top-2.5">
								<div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2">
						<button
							onClick={() => setCommentSort("new")}
							className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${commentSort === "new" ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
						>
							Newest
						</button>
						<button
							onClick={() => setCommentSort("popular")}
							className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${commentSort === "popular" ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
						>
							Highest Rated
						</button>
					</div>
				</div>
			)}

			{comments.map((comment) => (
				<div
					key={comment.id}
					className={`pl-4 border-l-2 ${parentId ? "border-slate-100" : "border-slate-200"} py-2`}
				>
					<div className="bg-slate-50 p-3 rounded-lg group">
						<div className="flex justify-between items-center mb-1">
							<span className="text-sm font-bold text-slate-700">
								{comment.author?.name || "Anonymous"}
							</span>
							<span className="text-[10px] text-slate-400">
								{new Date(comment.createdAt).toLocaleTimeString()}
							</span>
						</div>
						<p className="text-sm text-slate-600 mb-3">{comment.content}</p>

						<div className="flex items-center gap-4 opacity-70 group-hover:opacity-100 transition-opacity">
							<div className="relative group/commentlikes">
								<button
									onClick={() => handleToggleLike(comment)}
									className={`flex items-center gap-1 text-[11px] font-semibold transition-colors ${
										comment.likes?.some((l) => l.user?.id === users[0]?.id)
											? "text-red-500"
											: "text-slate-400 hover:text-red-500"
									}`}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className={`h-4 w-4 ${comment.likes?.some((l) => l.user?.id === users[0]?.id) ? "fill-red-500" : ""}`}
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
									</svg>
									{comment.likes?.length || 0}
								</button>

								{(comment.likes ?? []).length > 0 && (
									<div className="absolute bottom-full left-0 mb-2 hidden group-hover/commentlikes:block z-10 w-48">
										<div className="bg-slate-900 text-white text-xs rounded-lg p-2 shadow-lg">
											<div className="font-semibold mb-1">Liked by:</div>
											<div className="space-y-1">
												{comment.likes!.slice(0, 5).map((like) => (
													<div
														key={like.id}
														className="flex items-center gap-2"
													>
														<img
															src={
																like.user?.avatar ||
																`https://ui-avatars.com/api/?name=${like.user?.name || "U"}`
															}
															className="w-4 h-4 rounded-full"
														/>
														<span>{like.user?.name || "Anonymous"}</span>
													</div>
												))}
												{comment.likes!.length > 5 && (
													<div className="text-slate-400">
														+{comment.likes!.length - 5} more
													</div>
												)}
											</div>
										</div>
									</div>
								)}
							</div>

							<button
								onClick={() => handleReply(comment.id)}
								className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
									/>
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
								parentId={comment.id}
							/>
						</div>
					)}
				</div>
			))}
		</div>
	);
}

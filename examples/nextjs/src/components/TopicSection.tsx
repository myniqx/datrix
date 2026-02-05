"use client";

import { useState } from "react";
import { useForja } from "../hooks/useForja";
import { faker } from "@faker-js/faker";
import { generateBulkFakeComments } from "../utils/faker";
import CommentTree from "./CommentTree";
import type { Topic, User, Comment, Like } from "../schemas";
import { connect } from "http2";

interface TopicSectionProps {
	globalSearch?: string;
}

export default function TopicSection({ globalSearch }: TopicSectionProps) {
	const topicQuery: any = {
		populate: {
			author: true,
			comments: {
				populate: {
					author: true,
					likes: { populate: { user: true } },
					replies: { populate: { author: true } },
				},
			},
			likes: { populate: { user: true } },
		},
		orderBy: [{ field: "createdAt", direction: "desc" }],
	};

	if (globalSearch && globalSearch.trim()) {
		topicQuery.where = {
			$or: [
				{ title: { $contains: globalSearch } },
				{ content: { $contains: globalSearch } },
				{ comments: { content: { $contains: globalSearch } } },
				{ author: { name: { $contains: globalSearch } } },
			],
		};
	}

	const {
		data: topics,
		isLoading,
		error,
		create: createTopic,
		update: updateTopic,
		refetch: refetchTopics,
	} = useForja<Topic>("topic", topicQuery);
	const { data: users } = useForja<User>("user");
	const { create: createComment } = useForja<Comment>("comment");
	const { create: createLike, remove: removeLike } = useForja<Like>("like");

	const [isCreating, setIsCreating] = useState(false);
	const [expandedTopic, setExpandedTopic] = useState<number | null>(null);
	const [bulkCreating, setBulkCreating] = useState<number | null>(null);

	const handleAddTopic = async () => {
		if (!users.length) return;
		setIsCreating(true);
		try {
			const randomUser = users[Math.floor(Math.random() * users.length)];
			await createTopic({
				title: faker.lorem.sentence(),
				content: faker.lorem.paragraphs(2),
				author: randomUser.id,
			});
		} finally {
			setIsCreating(false);
		}
	};

	const handleBulkAddComments = async (topicId: number) => {
		if (!users.length) return;
		setBulkCreating(topicId);
		try {
			const comments = await generateBulkFakeComments(
				topicId,
				users,
				5,
				createComment,
			);
			await updateTopic(topicId, {
				comments: { connect: comments.map((c) => c.id) },
			});
			refetchTopics();
		} finally {
			setBulkCreating(null);
		}
	};

	const handleToggleTopicLike = async (topic: Topic) => {
		if (!users.length) return;
		const activeUser = users[0];
		const existingLike = topic.likes?.find((l) => l.user?.id === activeUser.id);

		if (existingLike) {
			await removeLike(existingLike.id);
		} else {
			await createLike({ user: activeUser.id, topic: topic.id });
		}
		refetchTopics();
	};

	return (
		<section className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-2xl font-black text-slate-900 tracking-tight">
						Latest Discussions
					</h3>
					<p className="text-slate-500">Explore and join the conversation</p>
				</div>
				<button
					onClick={handleAddTopic}
					disabled={isLoading || isCreating || !users.length}
					className="px-5 py-2.5 bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 text-slate-700 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
				>
					{isCreating ? (
						<span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
					) : (
						<svg
							className="w-4 h-4 text-indigo-600"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
					)}
					New Topic
				</button>
			</div>

			<div className="grid grid-cols-1 gap-6">
				{error && (
					<div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
						{error.message}
					</div>
				)}

				{isLoading && !topics.length ? (
					<div className="space-y-4">
						{[1, 2].map((i) => (
							<div
								key={i}
								className="h-48 bg-white border border-slate-100 rounded-2xl animate-pulse"
							/>
						))}
					</div>
				) : (
					<div className="space-y-6">
						{topics.map((topic: Topic) => (
							<article
								key={topic.id}
								className="group bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all relative overflow-hidden"
							>
								<div className="flex gap-4 mb-4">
									<img
										src={
											topic.author?.avatar ||
											`https://ui-avatars.com/api/?name=${encodeURIComponent(topic.author?.name || "A")}&background=random`
										}
										className="w-10 h-10 rounded-full shrink-0 outline-4 outline-slate-50"
									/>
									<div>
										<h4 className="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
											{topic.title}
										</h4>
										<div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
											<span>{topic.author?.name || "Anonymous"}</span>
											<span>•</span>
											<span>
												{new Date(topic.createdAt).toLocaleDateString()}
											</span>
										</div>
									</div>
								</div>

								<p className="text-slate-600 text-sm leading-relaxed mb-6 line-clamp-3">
									{topic.content}
								</p>

								<div className="flex items-center justify-between pt-4 border-t border-slate-100">
									<div className="flex items-center gap-4">
										<button
											onClick={() =>
												setExpandedTopic(
													expandedTopic === topic.id ? null : topic.id,
												)
											}
											className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors"
										>
											<svg
												className="w-4 h-4"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
												/>
											</svg>
											{topic.comments?.length || 0} Comments
										</button>

										<div className="relative group/likes">
											<button
												onClick={() => handleToggleTopicLike(topic)}
												className={`flex items-center gap-1.5 text-xs font-bold transition-colors ${
													topic.likes?.some((l) => l.user?.id === users[0]?.id)
														? "text-rose-600"
														: "text-slate-500 hover:text-rose-600"
												}`}
											>
												<svg
													className={`w-4 h-4 ${topic.likes?.some((l) => l.user?.id === users[0]?.id) ? "fill-rose-600" : ""}`}
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth={2}
														d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
													/>
												</svg>
												{topic.likes?.length || 0}
											</button>

											{(topic.likes ?? []).length > 0 && (
												<div className="absolute bottom-full left-0 mb-2 hidden group-hover/likes:block z-10 w-48">
													<div className="bg-slate-900 text-white text-xs rounded-lg p-2 shadow-lg">
														<div className="font-semibold mb-1">Liked by:</div>
														<div className="space-y-1">
															{topic.likes?.slice(0, 5).map((like) => (
																<div
																	key={like.id}
																	className="flex items-center gap-2"
																>
																	<img
																		src={like.user?.avatar}
																		className="w-4 h-4 rounded-full"
																	/>
																	<span>{like.user?.name}</span>
																</div>
															))}
															{(topic.likes ?? []).length > 5 && (
																<div className="text-slate-400">
																	+{topic.likes!.length - 5} more
																</div>
															)}
														</div>
													</div>
												</div>
											)}
										</div>

										<button
											onClick={() => handleBulkAddComments(topic.id)}
											disabled={bulkCreating === topic.id}
											className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-50"
										>
											{bulkCreating === topic.id ? (
												<span className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
											) : (
												<svg
													className="w-4 h-4"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth={2}
														d="M12 4v16m8-8H4"
													/>
												</svg>
											)}
											Add 5 Comments
										</button>
									</div>

									<div className="flex -space-x-2">
										{topic.comments?.slice(0, 3).map((comment, idx) => (
											<img
												key={idx}
												src={
													comment.author?.avatar ||
													`https://ui-avatars.com/api/?name=${encodeURIComponent(comment.author?.name || "C")}&background=random`
												}
												className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
												title={comment.author?.name}
											/>
										))}
										{(topic.comments?.length || 0) > 3 && (
											<div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-500">
												+{(topic.comments?.length || 0) - 3}
											</div>
										)}
									</div>
								</div>

								{expandedTopic === topic.id && (
									<div className="mt-6 pt-6 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
										<CommentTree
											comments={topic.comments || []}
											topicId={topic.id}
											users={users}
										/>
									</div>
								)}
							</article>
						))}

						{!topics.length && !isLoading && (
							<div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
								<div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-200">
									<svg
										className="w-10 h-10"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={1.5}
											d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
										/>
									</svg>
								</div>
								<h4 className="text-xl font-bold text-slate-900">
									Silence is golden?
								</h4>
								<p className="text-slate-500 max-w-xs mx-auto mt-2">
									No topics found. Start a new discussion to see Forja's
									relations in action.
								</p>
							</div>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

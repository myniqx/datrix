"use client";

import { useState } from "react";
import { useForja } from "../hooks/useForja";
import { faker } from "@faker-js/faker";
import type { User } from "../schemas";

export default function UserSection() {
	const { data: users, isLoading, error, create } = useForja<User>("user");
	const [isCreating, setIsCreating] = useState(false);

	const handleAddUser = async () => {
		setIsCreating(true);
		try {
			await create({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				role: "user",
				avatar: faker.image.avatar(),
			});
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
			<div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
				<div>
					<h3 className="text-xl font-bold text-slate-900">Active Users</h3>
					<p className="text-sm text-slate-500">
						Manage your community members
					</p>
				</div>
				<button
					onClick={handleAddUser}
					disabled={isLoading || isCreating}
					className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-xl shadow-sm shadow-indigo-200 transition-all flex items-center gap-2 active:scale-95"
				>
					{isCreating ? (
						<span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
					Generate User
				</button>
			</div>

			<div className="p-6">
				{error && (
					<div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
						<svg
							className="w-5 h-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						{error.message}
					</div>
				)}

				{isLoading && !users?.length ? (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-20 bg-slate-100 animate-pulse rounded-xl"
							/>
						))}
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{users.map((user) => (
							<div
								key={user.id}
								className="group p-4 rounded-xl border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all flex items-center gap-4"
							>
								<div className="relative">
									<img
										src={
											user.avatar ||
											`https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`
										}
										alt={user.name}
										className="w-12 h-12 rounded-full border-2 border-white shadow-sm"
									/>
									<div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" />
								</div>
								<div className="flex-1 min-w-0">
									<h4 className="font-semibold text-slate-900 truncate">
										{user.name}
									</h4>
									<p className="text-xs text-slate-500 truncate">
										{user.email}
									</p>
								</div>
								<div className="opacity-0 group-hover:opacity-100 transition-opacity">
									<span className="px-2 py-0.5 bg-white border border-slate-200 text-[10px] font-bold text-slate-400 rounded uppercase tracking-wider shadow-sm">
										{user.role}
									</span>
								</div>
							</div>
						))}
						{!users?.length && !isLoading && (
							<div className="col-span-full py-12 text-center">
								<div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
									<svg
										className="w-8 h-8"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={1.5}
											d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
										/>
									</svg>
								</div>
								<p className="text-slate-500 font-medium">No users found</p>
								<p className="text-sm text-slate-400">
									Click the button above to generate some fake data.
								</p>
							</div>
						)}
					</div>
				)}
			</div>
		</section>
	);
}

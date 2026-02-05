import { faker } from "@faker-js/faker";

export const generateFakeUser = () => ({
	name: faker.person.fullName(),
	email: faker.internet.email(),
	avatar: faker.image.avatar(),
	role: faker.helpers.arrayElement(["user", "moderator"] as const),
});

export const generateFakeTopic = (authorId: number) => ({
	title: faker.lorem.sentence(),
	content: faker.lorem.paragraphs(2),
	author: authorId,
});

export const generateFakeComment = (
	topicId: number,
	authorId: number,
	parentId?: number,
) => ({
	content: faker.lorem.sentence(),
	topic: topicId,
	author: authorId,
	...(parentId ? { parent: parentId } : {}),
});

export const generateBulkFakeComments = async (
	topicId: number,
	users: any[],
	count: number,
	createFn: (data: any) => Promise<any>,
	parentId?: number,
) => {
	const results = [];
	for (let i = 0; i < count; i++) {
		const randomUser = users[Math.floor(Math.random() * users.length)];
		const comment = await createFn(
			generateFakeComment(topicId, randomUser.id, parentId),
		);
		results.push(comment);
	}
	return results;
};

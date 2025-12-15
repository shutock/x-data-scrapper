import { z } from "zod";

export const generalProfileSchema = z.object({
  username: z.string(),
  verification: z.enum(["blue", "business"]).optional(),
  name: z.string().optional(),
  profile_photo_url: z.string().optional(),
});

export const profileSchema = generalProfileSchema.extend({
  bio: z.string().optional(),
  profile_link: z.string(),
  cover_photo_url: z.string().optional(),
  registration_date: z.string(),
});

export const generalTweetSchema = z.object({
  author: generalProfileSchema,
  content: z.string(),
  url: z.string(),
  created_at: z.string(),
  metrics: z.object({
    comments: z.number(),
    retweets: z.number(),
    quotes: z.number(),
    likes: z.number(),
    views: z.number(),
  }),
  kind: z.enum(["tweet", "retweet", "quote"]),
});

export const schema = z.object({
  profile: profileSchema,
  stats: z.object({
    tweets: z.number(),
    following: z.number(),
    followers: z.number(),
    likes: z.number(),
  }),
  tweets: z.array(
    generalTweetSchema.extend({ child: generalTweetSchema.optional() }),
  ),
});

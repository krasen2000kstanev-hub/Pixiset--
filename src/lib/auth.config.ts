import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config. No database or bcrypt imports here so it can be used
 * from middleware. The Credentials provider with the real `authorize` lookup
 * lives in `auth.ts` (Node runtime only).
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
};

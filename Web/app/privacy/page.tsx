import Link from 'next/link';
export default function PrivacyPage() {
  return (
    <main className="auth-page">
      <article className="auth-content information-content">
        <Link className="auth-brand" href="/">
          Mathwave
        </Link>
        <h1>Mathwave privacy notice</h1>
        <p>Updated October 20, 2026</p>
        <p>
          Mathwave is a voice-controlled mathematics workspace for dyslexic
          students. It is operated by Isaac Wu. For privacy questions, contact
          isaacwu2000@gmail.com.
        </p>
        <h2>Accounts and Google sign-in</h2>
        <p>
          Google sign-in provides your Google account identifier, name, email
          address and profile information, which may include a profile picture.
          We use this information to create or identify your Mathwave account
          and link sign-in methods you authorize. Google sign-in requests basic
          identity permissions; it does not request access to your Gmail, Drive,
          Calendar or contacts. Neon manages account credentials and sessions.
        </p>
        <h2>Your work and AI requests</h2>
        <p>
          Mathwave stores your problems, steps, drafts and saved-work history in
          its cloud database. A guest browser receives a private identifier so
          its work can be recovered and moved into an account.
        </p>
        <p>
          When you use AI, relevant requests and mathematical context are sent
          to the AI provider. Voice AI also sends microphone audio while
          connected. Mathwave does not store raw audio recordings. AI providers
          process requests according to their own service and data policies.
        </p>
        <h2>Cookies and usage records</h2>
        <p>
          Cookies keep you signed in and identify your guest workspace. Browser
          storage also supports drafts, preferences and account changes.
          Mathwave records AI usage and time to enforce allowances. For guest
          abuse protection, the app uses a monthly changing, protected
          representation of an IP address rather than storing the raw address in
          its quota records. Hosting providers necessarily process network
          information to deliver the service.
        </p>
        <h2>Services that process data</h2>
        <p>
          Cloudflare hosts Mathwave. Neon stores application data and handles
          authentication. Google handles Google sign-in. OpenAI handles the
          currently configured AI requests. Information is sent to these
          services as needed for those functions.
        </p>
        <p>
          Mathwave does not use Google account information for advertising or
          sell it. Google account information is used for account access and
          management.
        </p>
        <h2>Export and deletion</h2>
        <p>
          Settings lets you export your saved work and delete your account after
          confirming your identity. Deletion removes the account and its
          application records from the active database; cleanup retries if
          interrupted. A small deletion marker remains to prevent old requests
          from restoring deleted work. Database backups can retain earlier
          copies until the configured backup retention expires. Files you export
          remain wherever you save them.
        </p>
        <Link className="auth-guest" href="/">
          Back to Mathwave
        </Link>
      </article>
    </main>
  );
}

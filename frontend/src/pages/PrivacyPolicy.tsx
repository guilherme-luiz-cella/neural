import { Link } from 'react-router-dom';

export const PrivacyPolicy = () => (
  <div className="min-h-screen bg-gray-950 text-gray-300 py-12 px-4">
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <Link to="/login" className="text-purple-400 hover:text-purple-300 text-sm">
          ← Back to Login
        </Link>
      </div>

      <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-gray-500 text-sm mb-8">Last Updated: May 2026</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
          <p className="leading-relaxed">
            Neural Network ("we", "our", or "us") operates the Neural Network application. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our service and the choices you have associated with that data.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">2. Information Collection and Use</h2>
          <p className="mb-4">We collect several different types of information for various purposes to provide and improve our service:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li><strong>Account Information:</strong> Email address and authentication credentials</li>
            <li><strong>Google Drive Data:</strong> File names, types, and content (only when synced)</li>
            <li><strong>GitHub Data:</strong> Repository information and file references</li>
            <li><strong>Usage Data:</strong> Access logs, IP addresses, and application interactions</li>
            <li><strong>Device Information:</strong> Browser type, operating system, and device identifiers</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">3. Google Drive Integration</h2>
          <p className="mb-4">When you connect your Google Drive account:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>We only access files you explicitly authorize us to sync</li>
            <li>We store file metadata and content for analysis purposes</li>
            <li>Your Google account email is stored for account verification</li>
            <li>We verify that the connected account matches your login account for security</li>
            <li>You can disconnect at any time, and we will delete associated data within 30 days</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">4. GitHub Integration</h2>
          <p className="mb-4">When you connect GitHub:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>We access only repositories you authorize</li>
            <li>We analyze file content for connection detection</li>
            <li>We respect GitHub's rate limits and crawling policies</li>
            <li>Repository data is cached locally for performance</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">5. Data Storage and Security</h2>
          <p className="mb-4">Your data is stored securely using:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Encrypted connections (HTTPS/TLS) for all data transmission</li>
            <li>Supabase database with enterprise-grade security</li>
            <li>Access tokens are stored securely and never shared</li>
            <li>Passwords are hashed and salted using industry standards</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">6. Data Processing and Analytics</h2>
          <p className="mb-4">We use your data to:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Detect connections between files using semantic and name-based analysis</li>
            <li>Build and display the neural network graph visualization</li>
            <li>Improve algorithm accuracy and performance</li>
            <li>Send you important service notifications</li>
            <li>Investigate and prevent fraudulent activity</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">7. Third-Party Services</h2>
          <p className="mb-4">We use the following third-party services:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li><strong>Supabase:</strong> For database and authentication services</li>
            <li><strong>Google OAuth:</strong> For authentication and Drive access</li>
            <li><strong>GitHub OAuth:</strong> For authentication and repository access</li>
            <li><strong>Cloudflare Workers:</strong> For API backend hosting</li>
          </ul>
          <p className="mt-4">Each service has its own privacy policy, and we encourage you to review them.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">8. Account Mismatch Security</h2>
          <p className="mb-4">
            For your security, we verify that your Google Drive account matches your login account. If a mismatch is detected:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Your Drive connection will be automatically disconnected</li>
            <li>You will be logged out of the application</li>
            <li>You will need to reconnect with the correct account</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">9. Your Rights</h2>
          <p className="mb-4">You have the right to:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Access your personal data at any time</li>
            <li>Request deletion of your account and associated data</li>
            <li>Export your data in a machine-readable format</li>
            <li>Opt-out of specific data processing activities</li>
            <li>Disconnect third-party integrations (Google Drive, GitHub)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">10. Data Retention</h2>
          <p className="mb-4">
            We retain your data for as long as your account is active. When you delete your account or disconnect integrations:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Your personal data is deleted within 7 days</li>
            <li>Cached file data is deleted within 30 days</li>
            <li>Backup copies are retained for 90 days for disaster recovery</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">11. Cookies and Tracking</h2>
          <p className="mb-4">
            We use minimal cookies only for authentication and session management. We do not use tracking cookies or third-party analytics cookies.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">12. Children's Privacy</h2>
          <p className="mb-4">
            Our service is not directed to children under 13. We do not knowingly collect personal data from children under 13. If we become aware of such collection, we will delete the data immediately.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">13. Changes to This Privacy Policy</h2>
          <p className="mb-4">
            We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">14. Contact Us</h2>
          <p className="mb-4">
            If you have any questions about this Privacy Policy, please contact us at:
          </p>
          <p className="ml-4">
            <strong>Email:</strong> privacy@neural-network.dev<br />
            <strong>Address:</strong> Neural Network Support<br />
            <strong>Response Time:</strong> 7 business days
          </p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-800">
        <p className="text-sm text-gray-600 mb-4">
          © 2026 Neural Network. All rights reserved.
        </p>
        <div className="flex gap-6 text-sm">
          <Link to="/terms" className="text-purple-400 hover:text-purple-300">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-gray-600 cursor-default">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  </div>
);

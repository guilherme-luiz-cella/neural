import { Link } from 'react-router-dom';

export const TermsOfService = () => (
  <div className="min-h-screen bg-gray-950 text-gray-300 py-12 px-4">
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <Link to="/login" className="text-purple-400 hover:text-purple-300 text-sm">
          ← Back to Login
        </Link>
      </div>

      <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
      <p className="text-gray-500 text-sm mb-8">Last Updated: May 2026</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">1. Agreement to Terms</h2>
          <p className="leading-relaxed">
            By accessing and using the Neural Network service ("Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">2. Use License</h2>
          <p className="mb-4">
            Permission is granted to temporarily download one copy of the materials (information or software) on Neural Network's website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Modifying or copying the materials</li>
            <li>Using the materials for any commercial purpose or for any public display</li>
            <li>Attempting to decompile or reverse engineer any software contained on the Service</li>
            <li>Removing any copyright or other proprietary notations from the materials</li>
            <li>Transferring the materials to another person or "mirroring" the materials on any other server</li>
            <li>Violating any applicable laws or regulations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">3. Account Responsibility</h2>
          <p className="mb-4">
            When you create an account with Neural Network, you are responsible for:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Maintaining the confidentiality of your password and account information</li>
            <li>Accepting responsibility for all activities that occur under your account</li>
            <li>Immediately notifying us of any unauthorized use of your account</li>
            <li>Ensuring that your account information is accurate and complete</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">4. Third-Party Integrations</h2>
          <p className="mb-4">
            The Service allows you to connect with third-party services including Google Drive and GitHub:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>You are solely responsible for your use of these services</li>
            <li>We are not liable for third-party service interruptions or changes</li>
            <li>Your use of third-party services is governed by their respective terms</li>
            <li>We may modify or discontinue support for integrations at any time</li>
            <li>You can disconnect integrations at any time from your account settings</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">5. User Content and Intellectual Property</h2>
          <p className="mb-4">
            Regarding content you upload or connect through integrations:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>You retain all ownership rights to your content</li>
            <li>By using the Service, you grant us a license to process and analyze your content</li>
            <li>We will not share your content with third parties without consent (except as required by law)</li>
            <li>We respect copyright and intellectual property rights</li>
            <li>You are responsible for ensuring you have the right to share connected content</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">6. Prohibited Activities</h2>
          <p className="mb-4">
            You agree not to engage in any of the following activities:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Harassing or causing distress or inconvenience to any person</li>
            <li>Transmitting viruses, trojans, or any malicious code</li>
            <li>Attempting to gain unauthorized access to our systems</li>
            <li>Spamming or sending unsolicited communications</li>
            <li>Using automated tools or scripts without permission</li>
            <li>Excessive scraping or data mining of the Service</li>
            <li>Violating any applicable laws or regulations</li>
            <li>Impersonating any person or entity</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">7. Service Availability</h2>
          <p className="mb-4">
            Neural Network provides the Service on an "AS IS" and "AS AVAILABLE" basis. We make no warranties regarding:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Continuous availability or performance of the Service</li>
            <li>Accuracy or completeness of analysis results</li>
            <li>Security of data transmission or storage</li>
            <li>Fitness for any particular purpose</li>
          </ul>
          <p className="mt-4">
            We reserve the right to modify, suspend, or discontinue the Service at any time with or without notice.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">8. Limitation of Liability</h2>
          <p className="mb-4">
            In no event shall Neural Network, its directors, employees, or agents be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Loss of data or files</li>
            <li>Loss of profits or revenue</li>
            <li>Business interruption</li>
            <li>Reputational harm</li>
            <li>Damages arising from use of the Service</li>
          </ul>
          <p className="mt-4">
            Our total liability shall not exceed the amount you have paid us in the last 12 months.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">9. Indemnification</h2>
          <p className="mb-4">
            You agree to indemnify and hold harmless Neural Network from any claims, damages, losses, and expenses arising from:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Your use of the Service in violation of these terms</li>
            <li>Your infringement of any intellectual property rights</li>
            <li>Your violation of applicable laws or regulations</li>
            <li>Your content or the content you connect to the Service</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">10. Data Handling and Security</h2>
          <p className="mb-4">
            We implement industry-standard security measures, but we cannot guarantee absolute security:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>All data is transmitted over encrypted HTTPS connections</li>
            <li>Access tokens and passwords are encrypted at rest</li>
            <li>We maintain regular security audits and penetration testing</li>
            <li>You are responsible for keeping your credentials secure</li>
            <li>In case of a breach, we will notify affected users as required by law</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">11. Termination</h2>
          <p className="mb-4">
            We may terminate or suspend your account and access to the Service immediately, without prior notice or liability, if:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>You breach any provision of these Terms</li>
            <li>We are required to do so by law</li>
            <li>We detect suspicious or fraudulent activity</li>
            <li>You violate our acceptable use policy</li>
          </ul>
          <p className="mt-4">
            Upon termination, your access to the Service will be immediately removed.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">12. Payment Terms (if applicable)</h2>
          <p className="mb-4">
            If you subscribe to a paid plan:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Payments are due as specified in your subscription</li>
            <li>Refunds are not provided for partially used billing periods</li>
            <li>We may change pricing with 30 days' notice</li>
            <li>You may cancel your subscription at any time</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">13. Disclaimer of Warranties</h2>
          <p className="mb-4">
            The materials on Neural Network's website are provided on an "as is" basis. Neural Network makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">14. Governing Law</h2>
          <p className="mb-4">
            These terms and conditions are governed by and construed in accordance with the laws of the jurisdiction where Neural Network operates, and you irrevocably submit to the exclusive jurisdiction of the courts in that location.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">15. Dispute Resolution</h2>
          <p className="mb-4">
            Any dispute arising from these Terms shall first be addressed through good-faith negotiation. If negotiation fails, the dispute shall be resolved through binding arbitration or litigation as permitted by applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">16. Changes to Terms</h2>
          <p className="mb-4">
            Neural Network reserves the right to modify these terms at any time. We will notify users of significant changes via email or through the Service. Your continued use constitutes acceptance of the modified terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">17. Entire Agreement</h2>
          <p className="mb-4">
            These Terms of Service, along with our Privacy Policy, constitute the entire agreement between you and Neural Network regarding your use of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">18. Severability</h2>
          <p className="mb-4">
            If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited to the minimum extent necessary, and all other provisions shall remain in effect.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">19. Contact Information</h2>
          <p className="mb-4">
            For questions or concerns regarding these Terms of Service:
          </p>
          <p className="ml-4">
            <strong>Email:</strong> legal@neural-network.dev<br />
            <strong>Address:</strong> Neural Network Legal Team<br />
            <strong>Response Time:</strong> 14 business days
          </p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-800">
        <p className="text-sm text-gray-600 mb-4">
          © 2026 Neural Network. All rights reserved.
        </p>
        <div className="flex gap-6 text-sm">
          <Link to="/terms" className="text-gray-600 cursor-default">
            Terms of Service
          </Link>
          <Link to="/privacy" className="text-purple-400 hover:text-purple-300">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  </div>
);

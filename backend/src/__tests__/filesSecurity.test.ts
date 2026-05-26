import { describe, it, expect } from 'vitest';
import { buildCreateFilePayload, buildUpdateFilePayload } from '../routes/files';

describe('file payload security', () => {
  it('allowlists fields when creating files', () => {
    const payload = buildCreateFilePayload('user-1', {
      file_name: ' notes.md ',
      file_type: 'text/markdown',
      project_id: 'project-1',
      content: '# Notes',
      user_id: 'attacker',
      github_sha: 'malicious',
    } as never);

    expect(payload).toEqual({
      user_id: 'user-1',
      file_name: 'notes.md',
      file_type: 'text/markdown',
      project_id: 'project-1',
      content: '# Notes',
    });
    expect(payload).not.toHaveProperty('github_sha');
  });

  it('allowlists fields when updating files', () => {
    const payload = buildUpdateFilePayload({
      file_name: ' renamed.md ',
      content: '# Renamed',
      project_id: null,
      user_id: 'attacker',
      google_drive_id: 'stolen',
    } as never);

    expect(payload).toMatchObject({
      file_name: 'renamed.md',
      content: '# Renamed',
      project_id: null,
    });
    expect(payload.updated_at).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty('user_id');
    expect(payload).not.toHaveProperty('google_drive_id');
  });
});

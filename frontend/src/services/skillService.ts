import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type { CustomSkill } from '@/types/user.types';
import { validateRequired } from '@/utils/validation';

async function listSkills(workspaceId: string): Promise<CustomSkill[]> {
  validateRequired(workspaceId, 'Workspace');

  return withAuth(async () => {
    const response = await apiClient.get<CustomSkill[]>(
      `/skills?workspace_id=${encodeURIComponent(workspaceId)}`,
    );
    return ensureResponse(response, 'Failed to fetch skills');
  });
}

export interface SkillFileEntry {
  path: string;
  content: string;
  is_binary: boolean;
}

interface SkillFilesResponse {
  name: string;
  files: SkillFileEntry[];
}

async function getSkillFiles(
  workspaceId: string,
  source: string,
  skillName: string,
): Promise<SkillFileEntry[]> {
  validateRequired(workspaceId, 'Workspace');
  validateRequired(source, 'Source');
  validateRequired(skillName, 'Skill name');

  return withAuth(async () => {
    const response = await apiClient.get<SkillFilesResponse>(
      `/skills/${source}/${skillName}/files?workspace_id=${encodeURIComponent(workspaceId)}`,
    );
    const data = ensureResponse(response, 'Failed to fetch skill files');
    return data.files;
  });
}

async function updateSkill(
  workspaceId: string,
  source: string,
  skillName: string,
  files: SkillFileEntry[],
): Promise<CustomSkill> {
  validateRequired(workspaceId, 'Workspace');
  validateRequired(source, 'Source');
  validateRequired(skillName, 'Skill name');

  return withAuth(async () => {
    const response = await apiClient.put<CustomSkill>(
      `/skills/${source}/${skillName}?workspace_id=${encodeURIComponent(workspaceId)}`,
      { files },
    );
    return ensureResponse(response, 'Failed to update skill');
  });
}

export const skillService = {
  listSkills,
  getSkillFiles,
  updateSkill,
};

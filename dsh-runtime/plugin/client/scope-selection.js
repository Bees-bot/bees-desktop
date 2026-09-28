export function firstTeamForOrganization(data, organizationId, connectionId = "") {
  return data.teams.find((team) => team.organizationId === organizationId &&
    (!connectionId || data.connectionTeams?.some((access) =>
      access.connectionId === connectionId && access.teamId === team.id)));
}

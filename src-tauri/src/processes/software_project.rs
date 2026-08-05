//! Native Git isolation for the Software Project Studio.

use crate::Database;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};
use tauri::{Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareProjectMapping {
    work_item_id: String,
    repository_path: String,
    worktree_path: String,
    base_branch: String,
    project_branch: String,
    validated_at: String,
    missing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SoftwareProjectKind {
    New,
    Existing,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareProjectSelection {
    mapping: SoftwareProjectMapping,
    project_kind: SoftwareProjectKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCommit {
    sha: String,
    subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    head: String,
    branch: String,
    dirty: bool,
    status: Vec<String>,
    commits: Vec<ProjectCommit>,
    additions: usize,
    deletions: usize,
    generated_changes: usize,
    diff: String,
    truncated: bool,
}

fn now() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis}")
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            format!("Git {} failed with {}", args.join(" "), output.status)
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_probe(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            result.push(character);
            separator = false;
        } else if !separator && !result.is_empty() {
            result.push('-');
            separator = true;
        }
    }
    let result = result.trim_matches('-');
    if result.is_empty() {
        "project".into()
    } else {
        result.chars().take(48).collect()
    }
}

fn item_title(database: &Database, work_item_id: &str) -> Result<String, String> {
    database
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .query_row(
            "SELECT title FROM work_items WHERE id = ?1 AND deleted_at IS NULL",
            [work_item_id],
            |row| row.get(0),
        )
        .map_err(|_| "Software project work item not found".to_string())
}

fn mapping(database: &Database, work_item_id: &str) -> Result<SoftwareProjectMapping, String> {
    database
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .query_row(
            "SELECT work_item_id, repository_path, worktree_path, base_branch,
                    project_branch, validated_at, missing
             FROM software_project_mappings WHERE work_item_id = ?1",
            [work_item_id],
            |row| {
                Ok(SoftwareProjectMapping {
                    work_item_id: row.get(0)?,
                    repository_path: row.get(1)?,
                    worktree_path: row.get(2)?,
                    base_branch: row.get(3)?,
                    project_branch: row.get(4)?,
                    validated_at: row.get(5)?,
                    missing: row.get::<_, i64>(6)? != 0,
                })
            },
        )
        .map_err(|_| "Configure a Git repository for this software project first".to_string())
}

fn save_mapping(database: &Database, value: &SoftwareProjectMapping) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .execute(
            "INSERT INTO software_project_mappings
             (work_item_id, repository_path, worktree_path, base_branch, project_branch,
              validated_at, missing)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT(work_item_id) DO UPDATE SET
               repository_path = excluded.repository_path,
               worktree_path = excluded.worktree_path,
               base_branch = excluded.base_branch,
               project_branch = excluded.project_branch,
               validated_at = excluded.validated_at,
               missing = 0",
            params![
                value.work_item_id,
                value.repository_path,
                value.worktree_path,
                value.base_branch,
                value.project_branch,
                value.validated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("Project path is not a directory".into());
    }
    Ok(path)
}

fn separate_from_team(worktree: &Path, team_root: &str) -> Result<(), String> {
    let team = canonical_directory(team_root)?;
    if worktree == team || worktree.starts_with(&team) || team.starts_with(worktree) {
        return Err("Project code must be outside the synced team folder".into());
    }
    Ok(())
}

pub(crate) fn canonical_project_workspace(
    database: &Database,
    work_item_id: &str,
    offered: &str,
) -> Result<PathBuf, String> {
    let value = mapping(database, work_item_id)?;
    let expected = canonical_directory(&value.worktree_path)
        .map_err(|_| "The software project worktree is unavailable".to_string())?;
    let offered = canonical_directory(offered)
        .map_err(|_| "The requested software project worktree is unavailable".to_string())?;
    if expected != offered {
        return Err("The requested worktree does not belong to this software project".into());
    }
    let top = git(&expected, &["rev-parse", "--show-toplevel"])?;
    if canonical_directory(&top)? != expected {
        return Err("The mapped worktree is not a Git repository root".into());
    }
    let branch = git(&expected, &["branch", "--show-current"])?;
    if branch != value.project_branch {
        return Err(format!(
            "Check out the software project's {} branch before continuing",
            value.project_branch
        ));
    }
    Ok(expected)
}

fn project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join("Bees")
        .join("projects");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    canonical_directory(&root.to_string_lossy())
}

fn selected_project_kind(path: &Path) -> Result<SoftwareProjectKind, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let contains_project_files = fs::read_dir(&path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .any(|entry| entry.file_name() != ".git");
    let repository = git_probe(&path, &["rev-parse", "--show-toplevel"])
        .map(|value| canonical_directory(&value))
        .transpose()?;
    if repository.as_ref().is_some_and(|root| root != &path) {
        return Err("Choose the Git repository root, not one of its subfolders".into());
    }
    let has_commit = repository
        .as_ref()
        .is_some_and(|root| git_probe(root, &["rev-parse", "--verify", "HEAD"]).is_some());
    if contains_project_files && repository.is_none() {
        return Err(
            "This folder contains files but is not a Git repository. Initialize or clone it first."
                .into(),
        );
    }
    if contains_project_files && !has_commit {
        return Err(
            "This Git repository needs an initial commit before Bees can continue it".into(),
        );
    }
    Ok(if contains_project_files || has_commit {
        SoftwareProjectKind::Existing
    } else {
        SoftwareProjectKind::New
    })
}

#[tauri::command]
pub fn software_project_get(
    database: State<'_, Database>,
    work_item_id: String,
) -> Result<Option<SoftwareProjectMapping>, String> {
    let value = database
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .query_row(
            "SELECT work_item_id, repository_path, worktree_path, base_branch,
                    project_branch, validated_at, missing
             FROM software_project_mappings WHERE work_item_id = ?1",
            [&work_item_id],
            |row| {
                Ok(SoftwareProjectMapping {
                    work_item_id: row.get(0)?,
                    repository_path: row.get(1)?,
                    worktree_path: row.get(2)?,
                    base_branch: row.get(3)?,
                    project_branch: row.get(4)?,
                    validated_at: row.get(5)?,
                    missing: row.get::<_, i64>(6)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(value.map(|mut entry| {
        entry.missing = !Path::new(&entry.worktree_path).is_dir();
        entry
    }))
}

#[tauri::command]
pub fn software_project_select_folder(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    work_item_id: String,
    folder_path: String,
    team_root: String,
) -> Result<SoftwareProjectSelection, String> {
    if software_project_get(database.clone(), work_item_id.clone())?.is_some() {
        return Err("This software project already has a repository".into());
    }
    let selected = canonical_directory(&folder_path)?;
    separate_from_team(&selected, &team_root)?;
    let project_kind = selected_project_kind(&selected)?;
    if project_kind == SoftwareProjectKind::New
        && git_probe(&selected, &["rev-parse", "--show-toplevel"]).is_none()
    {
        git(&selected, &["init", "--initial-branch=main"])?;
    }
    let repository = canonical_directory(&git(&selected, &["rev-parse", "--show-toplevel"])?)?;
    if repository != selected {
        return Err("Choose the Git repository root, not one of its subfolders".into());
    }
    let base_branch = git(&repository, &["branch", "--show-current"])?;
    if base_branch.is_empty() {
        return Err("Check out the base branch in the selected repository first".into());
    }
    if project_kind == SoftwareProjectKind::New {
        git(
            &repository,
            &[
                "-c",
                "user.name=Bees",
                "-c",
                "user.email=local@bees.bot",
                "commit",
                "--allow-empty",
                "-m",
                "chore: initialize project",
            ],
        )?;
    } else if !git(&repository, &["status", "--short"])?.is_empty() {
        return Err("Commit or discard local changes before selecting this repository".into());
    }
    let title = item_title(&database, &work_item_id)?;
    let name = slug(&title);
    let branch = format!(
        "bees/project/{}-{}",
        name,
        &work_item_id[..8.min(work_item_id.len())]
    );
    let worktree = project_root(&app)?.join(format!(
        "{}-{}",
        name,
        &work_item_id[..8.min(work_item_id.len())]
    ));
    if worktree.exists() {
        return Err("The project worktree directory already exists".into());
    }
    separate_from_team(&worktree, &team_root)?;
    let worktree_text = worktree.to_string_lossy().into_owned();
    git(
        &repository,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            &worktree_text,
            &base_branch,
        ],
    )?;
    let worktree = canonical_directory(&worktree_text)?;
    let value = SoftwareProjectMapping {
        work_item_id,
        repository_path: repository.to_string_lossy().into_owned(),
        worktree_path: worktree.to_string_lossy().into_owned(),
        base_branch,
        project_branch: branch,
        validated_at: now(),
        missing: false,
    };
    save_mapping(&database, &value)?;
    Ok(SoftwareProjectSelection {
        mapping: value,
        project_kind,
    })
}

#[tauri::command]
pub fn software_project_workspace(
    database: State<'_, Database>,
    work_item_id: String,
) -> Result<String, String> {
    let value = mapping(&database, &work_item_id)?;
    canonical_project_workspace(&database, &work_item_id, &value.worktree_path)
        .map(|path| path.to_string_lossy().into_owned())
}

fn safe_relative(value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Git reported an unsafe project path".into());
    }
    Ok(value.to_owned())
}

fn changed_paths(worktree: &Path) -> Result<Vec<String>, String> {
    let mut paths = BTreeSet::new();
    for args in [
        &["diff", "--name-only", "-z"] as &[&str],
        &["diff", "--cached", "--name-only", "-z"],
        &["ls-files", "--others", "--exclude-standard", "-z"],
    ] {
        let output = git(worktree, args)?;
        for path in output.split('\0').filter(|path| !path.is_empty()) {
            paths.insert(safe_relative(path)?);
        }
    }
    Ok(paths.into_iter().collect())
}

#[tauri::command]
pub fn software_project_commit(
    database: State<'_, Database>,
    work_item_id: String,
    phase_id: String,
    execution_id: String,
    summary: String,
) -> Result<String, String> {
    let value = mapping(&database, &work_item_id)?;
    let worktree = canonical_project_workspace(&database, &work_item_id, &value.worktree_path)?;
    let paths = changed_paths(&worktree)?;
    if paths.is_empty() {
        return Err("The coding agent completed without changing project files".into());
    }
    for chunk in paths.chunks(100) {
        let mut args = vec!["add", "--"];
        args.extend(chunk.iter().map(String::as_str));
        git(&worktree, &args)?;
    }
    let staged = git(&worktree, &["diff", "--cached", "--name-only", "-z"])?;
    if staged.is_empty() {
        return Err("There are no project changes to commit".into());
    }
    let subject = summary
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(72)
        .collect::<String>();
    if subject.is_empty() {
        return Err("A commit summary is required".into());
    }
    let body =
        format!("Bees-Project: {work_item_id}\nBees-Phase: {phase_id}\nBees-Run: {execution_id}");
    git(
        &worktree,
        &[
            "-c",
            "user.name=Bees",
            "-c",
            "user.email=local@bees.bot",
            "commit",
            "-m",
            &subject,
            "-m",
            &body,
        ],
    )?;
    git(&worktree, &["rev-parse", "HEAD"])
}

fn generated(path: &str) -> bool {
    let name = path.to_lowercase();
    name.ends_with("package-lock.json")
        || name.ends_with("pnpm-lock.yaml")
        || name.ends_with("yarn.lock")
        || name.ends_with(".snap")
        || name.contains("/dist/")
        || name.starts_with("dist/")
        || name.contains("/build/")
        || name.starts_with("build/")
        || name.contains("/vendor/")
        || name.contains("generated")
}

fn base_ref(value: &SoftwareProjectMapping, requested: Option<String>) -> Result<String, String> {
    let reference = requested.unwrap_or_else(|| value.base_branch.clone());
    if reference.is_empty()
        || reference.len() > 160
        || !reference
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_/.".contains(character))
    {
        return Err("The review base is invalid".into());
    }
    Ok(reference)
}

#[tauri::command]
pub fn software_project_snapshot(
    database: State<'_, Database>,
    work_item_id: String,
    base_sha: Option<String>,
) -> Result<ProjectSnapshot, String> {
    let value = mapping(&database, &work_item_id)?;
    let worktree = canonical_project_workspace(&database, &work_item_id, &value.worktree_path)?;
    let base = base_ref(&value, base_sha)?;
    git(&worktree, &["rev-parse", "--verify", &base])?;
    let head = git(&worktree, &["rev-parse", "HEAD"])?;
    let branch = git(&worktree, &["branch", "--show-current"])?;
    let status_text = git(&worktree, &["status", "--short"])?;
    let status = status_text.lines().map(str::to_owned).collect::<Vec<_>>();
    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut generated_changes = 0usize;
    for line in git(&worktree, &["diff", "--numstat", &base])?.lines() {
        let mut columns = line.splitn(3, '\t');
        let added = columns.next().unwrap_or("0");
        let deleted = columns.next().unwrap_or("0");
        let path = columns.next().unwrap_or("");
        if generated(path) {
            generated_changes += 1;
        } else {
            additions += added.parse::<usize>().unwrap_or(0);
            deletions += deleted.parse::<usize>().unwrap_or(0);
        }
    }
    let commits = git(
        &worktree,
        &["log", "--format=%H%x09%s", &format!("{base}..HEAD")],
    )?
    .lines()
    .filter_map(|line| {
        let (sha, subject) = line.split_once('\t')?;
        Some(ProjectCommit {
            sha: sha.into(),
            subject: subject.into(),
        })
    })
    .collect();
    let raw_diff = git(&worktree, &["diff", "--no-ext-diff", "--unified=3", &base])?;
    let truncated = raw_diff.len() > 200_000;
    let diff = if truncated {
        raw_diff.chars().take(200_000).collect()
    } else {
        raw_diff
    };
    Ok(ProjectSnapshot {
        head,
        branch,
        dirty: !status.is_empty(),
        status,
        commits,
        additions,
        deletions,
        generated_changes,
        diff,
        truncated,
    })
}

#[tauri::command]
pub fn software_project_merge(
    database: State<'_, Database>,
    work_item_id: String,
) -> Result<String, String> {
    let value = mapping(&database, &work_item_id)?;
    let worktree = canonical_project_workspace(&database, &work_item_id, &value.worktree_path)?;
    if !git(&worktree, &["status", "--short"])?.is_empty() {
        return Err("Commit or review every project change before merging".into());
    }
    let repository = canonical_directory(&value.repository_path)?;
    if repository == worktree {
        git(&worktree, &["switch", &value.base_branch])?;
        git(
            &worktree,
            &[
                "-c",
                "user.name=Bees",
                "-c",
                "user.email=local@bees.bot",
                "merge",
                "--no-ff",
                &value.project_branch,
            ],
        )?;
        return git(&worktree, &["rev-parse", "HEAD"]);
    }
    if !git(&repository, &["status", "--short"])?.is_empty() {
        return Err(
            "The original repository has uncommitted changes; clean it before merging".into(),
        );
    }
    let current = git(&repository, &["branch", "--show-current"])?;
    if current != value.base_branch {
        return Err(format!(
            "Check out {} in the original repository before merging",
            value.base_branch
        ));
    }
    git(
        &repository,
        &[
            "-c",
            "user.name=Bees",
            "-c",
            "user.email=local@bees.bot",
            "merge",
            "--no-ff",
            &value.project_branch,
        ],
    )?;
    git(&repository, &["rev-parse", "HEAD"])
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    #[test]
    fn project_slugs_and_paths_are_boring() {
        assert_eq!(slug("My Great App!"), "my-great-app");
        assert!(safe_relative("src/app.ts").is_ok());
        assert!(safe_relative("../secret").is_err());
        assert!(safe_relative("/etc/passwd").is_err());
    }

    #[test]
    fn empty_folders_are_new_and_code_requires_git() {
        let root = std::env::temp_dir().join(format!(
            "bees-software-project-kind-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(
            selected_project_kind(&root).unwrap(),
            SoftwareProjectKind::New
        );
        fs::write(root.join("README.md"), "existing code").unwrap();
        assert!(selected_project_kind(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn committed_git_folders_are_existing_projects() {
        let root = std::env::temp_dir().join(format!(
            "bees-software-project-existing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "--initial-branch=main"]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Bees",
                "-c",
                "user.email=local@bees.bot",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        assert_eq!(
            selected_project_kind(&root).unwrap(),
            SoftwareProjectKind::Existing
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_files_do_not_count_as_source() {
        assert!(generated("package-lock.json"));
        assert!(generated("src/view.snap"));
        assert!(!generated("src/view.ts"));
    }

    #[test]
    fn execution_workspace_must_match_the_local_mapping() {
        let root = std::env::temp_dir().join(format!(
            "bees-software-project-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let worktree = root.join("worktree");
        let other = root.join("other");
        fs::create_dir_all(&worktree).unwrap();
        fs::create_dir_all(&other).unwrap();
        git(&worktree, &["init", "--initial-branch=main"]).unwrap();
        git(
            &worktree,
            &[
                "-c",
                "user.name=Bees",
                "-c",
                "user.email=local@bees.bot",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        git(&worktree, &["switch", "-c", "bees/project/test"]).unwrap();

        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE software_project_mappings (
                   work_item_id TEXT PRIMARY KEY,
                   repository_path TEXT NOT NULL,
                   worktree_path TEXT NOT NULL,
                   base_branch TEXT NOT NULL,
                   project_branch TEXT NOT NULL,
                   validated_at TEXT NOT NULL,
                   missing INTEGER NOT NULL
                 );",
            )
            .unwrap();
        let database = Database(Mutex::new(connection));
        save_mapping(
            &database,
            &SoftwareProjectMapping {
                work_item_id: "item-1".into(),
                repository_path: worktree.to_string_lossy().into_owned(),
                worktree_path: worktree.to_string_lossy().into_owned(),
                base_branch: "main".into(),
                project_branch: "bees/project/test".into(),
                validated_at: now(),
                missing: false,
            },
        )
        .unwrap();

        assert!(
            canonical_project_workspace(&database, "item-1", &worktree.to_string_lossy()).is_ok()
        );
        assert!(
            canonical_project_workspace(&database, "item-1", &other.to_string_lossy()).is_err()
        );
        git(&worktree, &["switch", "main"]).unwrap();
        assert!(
            canonical_project_workspace(&database, "item-1", &worktree.to_string_lossy()).is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
}

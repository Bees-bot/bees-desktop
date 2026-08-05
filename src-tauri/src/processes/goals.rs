pub const TASK_PLAN_OUTPUT: &str = ".tasks.json";
const PLAN: &str = "plan";
const WORK: &str = "work";
const WAITING: &str = "waiting";

pub fn validate_run(
    current_stage: &str,
    outputs: &[String],
    status_name: &str,
    stages: &[String],
) -> Result<(), String> {
    let stage = current_stage.trim().to_lowercase();
    if outputs.iter().any(|output| output == TASK_PLAN_OUTPUT) {
        if stage != PLAN {
            return Err("Only the Plan status can propose subtasks".into());
        }
        return Ok(());
    }
    let target = stages
        .iter()
        .find(|name| name.trim().to_lowercase() == status_name.trim().to_lowercase());
    if stage == PLAN {
        if !outputs.is_empty()
            || target.map(|name| name.trim().to_lowercase()) != Some(WORK.to_owned())
        {
            return Err(format!(
                "Goal planner must choose Work or write {TASK_PLAN_OUTPUT} for approval"
            ));
        }
        return Ok(());
    }
    let Some(target) = target else {
        return Err(format!(
            "Goal run must choose one of: {}",
            stages.join(", ")
        ));
    };
    if target.trim().to_lowercase() == WAITING {
        return Err("Waiting is reserved for goals with approved subtasks".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_runs_only_use_allowed_transitions() {
        let stages = vec![
            "Plan".into(),
            "Work".into(),
            "Waiting".into(),
            "Review".into(),
        ];
        let plan = vec![TASK_PLAN_OUTPUT.to_owned()];
        assert!(validate_run("Plan", &plan, "", &stages).is_ok());
        assert!(validate_run("Work", &plan, "", &stages).is_err());
        assert!(validate_run("Plan", &[], "Work", &stages).is_ok());
        assert!(validate_run("Plan", &[], "Review", &stages).is_err());
        assert!(validate_run("Work", &[], "Review", &stages).is_ok());
        assert!(validate_run("Work", &[], "Waiting", &stages).is_err());
        assert!(validate_run("Work", &[], "Nonsense", &stages).is_err());
    }
}

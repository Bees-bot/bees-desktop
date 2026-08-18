pub fn validate_run(
    current_state: &str,
    task_plan_output: &str,
    output_blocked_states: &[String],
    outputs: &[String],
) -> Result<(), String> {
    if !outputs.iter().any(|output| output == task_plan_output) {
        return Ok(());
    }
    if outputs.len() != 1 {
        let extras = outputs
            .iter()
            .filter(|output| *output != task_plan_output)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        return Err(if extras.is_empty() {
            format!("{task_plan_output} must be the run's only reviewable output")
        } else {
            format!(
                "This planning step also created: {extras}. Put file creation in the first planned task and retry"
            )
        });
    }
    let state = current_state.trim().to_lowercase();
    if output_blocked_states
        .iter()
        .any(|blocked| blocked.trim().to_lowercase() == state)
    {
        return Err(format!("The {current_state} state cannot propose tasks"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_plan_output_rules_are_data_driven() {
        let blocked = vec!["waiting".into(), "done".into()];
        let plan = vec!["plan.json".into()];
        assert!(validate_run("plan", "plan.json", &blocked, &plan).is_ok());
        assert!(validate_run("waiting", "plan.json", &blocked, &plan).is_err());
        assert_eq!(validate_run(
            "work",
            "plan.json",
            &blocked,
            &["plan.json".into(), "draft.md".into()]
        ), Err("This planning step also created: draft.md. Put file creation in the first planned task and retry".into()));
        assert!(validate_run("plan", "plan.json", &blocked, &[]).is_ok());
    }
}

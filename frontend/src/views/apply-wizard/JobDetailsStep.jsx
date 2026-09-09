import VacancyAdvert from '../../components/VacancyAdvert';

// The full vacancy write-up in UCAA's standard advert layout. Its own
// dedicated first step rather than a block pinned above every other step,
// so the actual form (Profile, Documents, Questions...) isn't crowded by
// a job posting the candidate has already read by the time they're
// filling anything in.
export default function JobDetailsStep({ vacancy }) {
  return (
    <VacancyAdvert
      jobRef={vacancy.jobRef}
      title={vacancy.title}
      departmentLabel={vacancy.department?.name
        ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
        : null}
      reportsToName={vacancy.reportsToPosition?.name}
      salaryScale={vacancy.salaryScale}
      positionsRequired={vacancy.positionsRequired}
      deadline={vacancy.deadline}
      jobPurpose={vacancy.jobPurpose}
      essentialRequirements={vacancy.essentialRequirements}
      minimumEducationLevel={vacancy.minimumEducationLevel}
      minimumExperienceYears={vacancy.minimumExperienceYears}
      preferredFieldOfStudy={vacancy.preferredFieldOfStudy}
      desirableRequirements={vacancy.desirableRequirements}
      generalKnowledge={vacancy.generalKnowledge}
      specialSkills={vacancy.specialSkills}
    />
  );
}

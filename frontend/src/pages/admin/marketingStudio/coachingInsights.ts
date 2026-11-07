// @ts-nocheck -- data and rules copied verbatim from the reference Marketing Studio (published version 5).
export const COACHING_INSIGHTS = [
  {
    id:'coaching-call-hiring-budget', pillar:'Strategy Tips', audience:'Boardroom', audienceStage:'Preparing to hire my first clinician.', topic:'Can your practice afford its first hire?', format:'Spoken',
    text:`A clinician wants to work for you. But can your practice afford to hire them?

That’s where the excitement needs a plan.

Before choosing a pay rate, look at:
• What the practice realistically expects to collect.
• Clinical and nonclinical compensation.
• Employer costs, supervision, and administrative support.
• Cash available while the clinician builds a caseload.
• What needs to remain for you and the business.

An interested clinician creates an opportunity. Your numbers help you decide when—and how—to move forward.

Save this before you make your first offer.`,
    closingScreen:'Save this before you make your first offer.'
  },
  {
    id:'coaching-call-breathing-room', pillar:'Inspirational Quote', audience:'Lounge', audienceStage:'Established practice', topic:'Planning for more breathing room', format:'B-roll',
    text:`“Your next business goal can be one more day of breathing room.”

Maybe you love being a therapist.

You just want to see clients three days a week instead of four. Take a vacation without calculating every session you’ll miss. Have room for your family without squeezing business tasks into every evening.

Those are meaningful business goals.

Give them numbers. Give them a timeline. Build a plan around them.

Your practice should support the life you want to live.`,
    closingScreen:'Your practice should support the life you want to live.'
  },
  {
    id:'coaching-call-growth-purpose', pillar:'Personal Story', audience:'Boardroom', audienceStage:'Preparing to hire or already leading a team', topic:'What do you want growth to make possible?', format:'Spoken',
    text:`I recently had a coaching conversation that reminded me why “I want to grow” needs a follow-up question:

What do you want growth to make possible?

More income?
Fewer clinical days?
More time to mentor?
The ability to take a vacation while the practice continues operating?

Each answer changes the plan.

In my own practice, bringing leaders into specific roles helped free up time for Boss Clinician. That required deciding which responsibilities I needed someone else to own.

Before you hire, get specific about what you want your role—and your week—to look like.`,
    closingScreen:'What do you want growth to make possible?'
  },
  {
    id:'coaching-call-three-clinical-days', pillar:'How-To Guide', audience:'Boardroom', audienceStage:'Preparing to hire my first clinician.', topic:'Reduce clinical days with a hiring plan', format:'Spoken',
    text:`Want to move from four clinical days to three?

Start here.

1. Decide how many sessions you actually want to keep.
2. Identify how much income those sessions currently contribute.
3. Calculate what a new clinician could contribute after compensation and operating costs.
4. Include the support you’ll need to manage a team.
5. Reduce your caseload in stages as the numbers support it.

Also ask: Where will the leadership and administrative work fit?

A lighter clinical schedule needs a plan for your total workload, too.

Save this for your next CEO planning day.`,
    closingScreen:'Save this for your next CEO planning day.'
  },
  {
    id:'coaching-call-clarity-next-step', pillar:'Success Story', contentLabel:'Coaching Insight', audience:'Boardroom', audienceStage:'Preparing to hire my first clinician.', topic:'Practice clarity before hiring', format:'Spoken',
    text:`Sometimes progress looks like knowing what to do first.

A practice owner can come into a strategy call with five connected questions:

What should I pay?
How does credentialing work?
What paperwork do I need?
Who handles billing?
What happens if insurance payments are delayed?

Trying to solve everything at once can leave you spinning.

A useful starting sequence is:
Define the goal.
Understand the numbers.
Confirm payer requirements.
Prepare the employment structure.
Hire, support, and review.

That’s the value of practice clarity: leaving with a direction you can act on.

If you’re preparing for your first hire, a Practice Clarity Call can help you identify your priorities and next steps.`,
    closingScreen:'Preparing for your first hire? A Practice Clarity Call can help you identify your next steps.', resourceName:'Practice Clarity Call'
  }
].map(p=>({...p,hook:p.text.split('\n\n')[0],script:p.text,caption:p.text,carousel:'',hashtags:p.audience==='Lounge'?'#BossClinician #PrivatePractice #PracticeOwner #TherapistLife':'#BossClinician #GroupPractice #PracticeOwner #ClinicalLeadership',ctaType:p.resourceName?'Practice Clarity Call invitation':'Save or reflective ending',dmWord:'',resourceName:p.resourceName||'',resourceUrl:'',postingDate:'',status:'Drafting',needsDetails:false,collection:'Coaching Call Insights',source:'Coaching content supplied by Yvette Howard',createdAt:'2026-10-31T00:00:00.000Z'}));

export function addCoachingInsights(posts){
  const ids=new Set(posts.map(p=>p.id));
  return [...posts,...COACHING_INSIGHTS.filter(p=>!ids.has(p.id)).map(p=>structuredClone(p))];
}

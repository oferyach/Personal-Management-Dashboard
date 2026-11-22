\# Project: Personal Management Dashboard — Full-Stack Web Application



\## 1. Objective



Build a complete, modern, production-ready, self-hosted web application in the \*\*current working directory\*\*.



The application will serve as a centralized personal management platform for:



1\. Calendar and event management.

2\. Task and project management.

3\. Digital asset management (images, videos, and eventually documents).

4\. Microsoft OneDrive integration.

5\. Email notifications and automated reminders.

6\. Multi-user authentication, authorization, profiles, and role management.

7\. A centralized dashboard with activity monitoring, statistics, and summaries.



The application must be fully functional, responsive, secure, maintainable, and ready for deployment to a Linux VPS or compatible hosting environment.



\*\*This is a real application, not a mockup, demonstration, or proof of concept.\*\*



Implement working backend APIs, database persistence, frontend interfaces, authentication, background jobs, and deployment infrastructure.



Do not stop after creating an architecture document or generating placeholder pages.



\---



\## 2. Development and Execution Rules



You are acting as an autonomous senior full-stack software engineer, architect, UI/UX designer, and DevOps engineer.



\### Working directory



\- Use the current working directory as the project root.

\- Inspect existing files before making changes.

\- Do not overwrite existing user files without good reason.

\- Create a clean, logical project structure.

\- Keep all source code, configuration files, documentation, and deployment files inside this project.

\- Do not create a second nested project directory unless necessary.



\### Execution approach



1\. Inspect the current environment and available tools.

2\. Design a suitable application architecture.

3\. Implement the application in logical stages.

4\. Install dependencies.

5\. Initialize the database and migrations.

6\. Build and run the application.

7\. Execute automated tests.

8\. Correct identified errors.

9\. Verify that the frontend and backend work together.

10\. Document development and production deployment procedures.



Make reasonable architectural decisions independently.



Do not ask questions about minor implementation details.



If external credentials or services are unavailable, implement the complete configuration and integration infrastructure without inventing credentials.



The application must remain usable without OneDrive or SMTP configuration.



Prioritize working, tested functionality over unnecessary architectural complexity.



\---



\## 3. Technology Stack



\### Preferred technologies



| Component | Preferred technology |

|---|---|

| Backend | Node.js with TypeScript |

| Frontend | React with TypeScript |

| Framework | Next.js or equivalent mature full-stack framework |

| Styling | Tailwind CSS |

| UI components | shadcn/ui or comparable accessible component library |

| Database | SQLite |

| ORM | Prisma or Drizzle ORM |

| Validation | Zod |

| Authentication | Established, actively maintained authentication library |

| Email | SMTP via Nodemailer or equivalent |

| OneDrive | Microsoft Graph API |

| Deployment | Docker / Docker Compose |

| Reverse proxy | Caddy or Nginx |

| Logging | Structured application logs |

| Testing | Vitest and Playwright or equivalents |



Use current stable, production-supported versions.



Prefer established open-source packages and avoid unnecessary dependencies.



\### Important architectural requirements



\- TypeScript throughout the project.

\- Clearly separate business logic, database access, API handlers, and UI components.

\- Use reusable services and components.

\- Design modules for future expansion.

\- Use SQLite initially, but avoid database-specific assumptions that unnecessarily prevent migration to PostgreSQL later.

\- Do not introduce Redis, Kubernetes, microservices, or other complex infrastructure unless genuinely justified.

\- Support deployment to a single small VPS.

\- Use server-side validation and authorization for all protected operations.



\---



\## 4. Application Design and User Experience



Create a modern, clean, professional interface.



The overall appearance should resemble a polished productivity application, not a generic administration template.



\### Design requirements



\- Responsive desktop, tablet, and mobile layouts.

\- Mobile-first behavior where appropriate.

\- Light and dark themes.

\- Consistent visual design.

\- Modern typography.

\- Clear navigation hierarchy.

\- Professional icons.

\- Smooth, restrained animations.

\- Accessible forms and controls.

\- Good keyboard navigation.

\- Loading indicators, empty states, and error states.

\- Confirmation dialogs for destructive operations.

\- Toast notifications for successful or failed actions.

\- Paginated or virtualized lists for large datasets.



\### Main navigation



Provide:



\- Dashboard

\- Calendar

\- Tasks

\- Projects

\- Assets

\- OneDrive

\- Notifications

\- Activity History

\- Users \& Roles (authorized users only)

\- Settings

\- My Profile



On desktop, use a collapsible sidebar.



On mobile, provide an appropriate compact navigation interface.



\### Language support



\- English as the initial default language.

\- Prepare the application for internationalization.

\- Support future Hebrew localization.

\- Ensure the layout architecture supports right-to-left languages.

\- Store dates and times in a timezone-safe format.

\- Default user timezone to `Asia/Jerusalem`, with the ability to change it in the user profile.



\---



\## 5. Dashboard



The dashboard is the application's primary landing page after login.



It should provide an immediately understandable overview of current activity.



\### Dashboard widgets



\*\*Calendar summary\*\*



\- Today's events.

\- Upcoming events.

\- Events occurring in the next seven days.

\- Events occurring in the next 30 days.

\- Next scheduled event.

\- Number of events by category.



\*\*Tasks summary\*\*



\- Total open tasks.

\- Tasks in progress.

\- Completed tasks.

\- Overdue tasks.

\- Tasks due today.

\- Tasks due this week.

\- Task completion percentage.



\*\*Projects summary\*\*



\- Active projects.

\- Completed projects.

\- Project progress.

\- Upcoming project deadlines.



\*\*Assets summary\*\*



\- Number of indexed images.

\- Number of indexed videos.

\- Total known asset size.

\- Recently added assets.

\- OneDrive synchronization status.



\*\*Activity summary\*\*



\- Recently created events.

\- Recently completed tasks.

\- Recently updated projects.

\- Recent asset synchronization activity.

\- Relevant administrative actions.



\### Dashboard features



\- Interactive charts.

\- Filters by date range.

\- Quick-action buttons.

\- Links from widgets to their corresponding pages.

\- Upcoming reminders.

\- Clear indication of overdue items.

\- User-specific dashboard information.



Where practical, let users customize which widgets appear and their order.



Avoid loading unnecessary data or running expensive queries on every dashboard refresh.



\---



\## 6. Calendar and Event Management



Implement a complete calendar module.



\### Core operations



Users must be able to:



\- Create events.

\- View events.

\- Edit events.

\- Delete events.

\- Duplicate events.

\- Search events.

\- Filter events.

\- Categorize events.



\### Calendar views



Support:



\- Month view.

\- Week view.

\- Day view.

\- Agenda/list view.



The calendar must work well on both desktop and mobile.



\### Event properties



Each event should support:



\- Unique identifier.

\- Title.

\- Detailed description.

\- Start date and time.

\- End date and time.

\- All-day event flag.

\- Timezone.

\- Location.

\- Category.

\- Color.

\- Status.

\- Owner.

\- Optional participants.

\- Creation and modification timestamps.

\- Reminder configuration.

\- Recurrence configuration.



\### Recurring events



Support common recurrence patterns:



\- Daily.

\- Weekly.

\- Monthly.

\- Yearly.

\- Custom intervals.



Allow editing or deleting:



\- One occurrence.

\- An occurrence and future occurrences.

\- The entire recurring series.



Handle recurring-event exceptions correctly.



\### Calendar interaction



\- Click a date to create an event.

\- Click an event to view details.

\- Edit an event through a convenient dialog or detail page.

\- Support drag-and-drop rescheduling where reliable.

\- Provide appropriate validation.

\- Clearly distinguish all-day events.

\- Display events using the user's configured timezone.



\### Calendar import/export



Provide basic support for:



\- Exporting events to iCalendar (.ics).

\- Importing events from a valid .ics file.



Design the module so that Google Calendar, Outlook Calendar, or other calendar synchronization services can be added later without restructuring the database.



Do not assume that external calendar synchronization is already configured.



\---



\## 7. Task Management



Create a complete task management system.



\### Core operations



Users must be able to:



\- Create tasks.

\- View tasks.

\- Edit tasks.

\- Delete tasks.

\- Update progress.

\- Mark tasks complete.

\- Reopen completed tasks.

\- Search tasks.

\- Filter tasks.

\- Sort tasks.

\- Assign tasks to authorized users.



\### Task properties



Each task should support:



\- Unique identifier.

\- Title.

\- Description.

\- Status.

\- Priority.

\- Progress percentage (0–100).

\- Creation date.

\- Start date.

\- Due date.

\- Completion date.

\- Assigned user.

\- Created-by user.

\- Optional parent task.

\- Optional project.

\- Tags.

\- Notes.

\- Reminder settings.

\- Last modification timestamp.



\### Task statuses



Use configurable or extensible statuses, initially:



\- Not Started

\- In Progress

\- Blocked

\- On Hold

\- Completed

\- Cancelled



\### Task priorities



\- Low

\- Normal

\- High

\- Urgent



\### Task views



Implement:



1\. List view.

2\. Kanban board.

3\. Due-date calendar view.

4\. Project-based task view.



\### Task progress



Support manual progress updates from 0% to 100%.



Record meaningful progress changes in task history.



Clearly display task status and progress.



Define consistent rules between completion status and progress percentage.



\### Additional features



\- Subtasks.

\- Task comments or notes.

\- Task activity history.

\- Bulk status updates.

\- Bulk completion.

\- Task duplication.

\- Overdue indicators.

\- Due-date reminders.



\---



\## 8. Project Management



Implement a lightweight project management module built on top of tasks.



Each project should support:



\- Name.

\- Description.

\- Owner.

\- Status.

\- Start date.

\- Target completion date.

\- Progress.

\- Associated tasks.

\- Assigned users.

\- Activity history.



Project progress should optionally be calculated from its tasks.



Provide a project overview with:



\- Total tasks.

\- Completed tasks.

\- Outstanding tasks.

\- Overdue tasks.

\- Overall progress.

\- Next milestone or upcoming deadline.



Keep project management simple and extensible rather than attempting to implement a full enterprise project-management suite.



\---



\## 9. Digital Asset Management



Create a digital asset management module for images and videos.



The initial primary objective is \*\*asset indexing, browsing, searching, categorization, and metadata management\*\*.



Avoid implementing an unnecessary video transcoding platform.



\### Asset types



Initially support:



\- JPEG.

\- PNG.

\- WebP.

\- GIF.

\- HEIC where technically supported.

\- MP4.

\- MOV.

\- MKV.

\- AVI.

\- Other common media formats.



Architect the system so that document management can be added later.



\### Asset metadata



Store metadata such as:



\- Internal asset ID.

\- Original filename.

\- File type.

\- MIME type.

\- File size.

\- Creation date.

\- Modification date.

\- Capture date if available.

\- Image dimensions.

\- Video duration.

\- Video resolution.

\- Source provider.

\- Source account.

\- Remote file identifier.

\- Remote folder path.

\- Tags.

\- Categories.

\- Description.

\- User notes.

\- Indexing status.

\- Last synchronization date.



Distinguish metadata extracted from the actual file from metadata supplied by a cloud provider.



Do not invent unavailable metadata.



\### Asset interface



Create:



\- Thumbnail grid view.

\- List view.

\- Asset details panel.

\- Image preview.

\- Video preview where browser-compatible.

\- Search by filename.

\- Filtering by media type.

\- Filtering by date.

\- Filtering by folder.

\- Tag-based filtering.

\- Sorting by common properties.

\- Multi-selection.

\- Bulk metadata editing.



\### Asset organization



Provide infrastructure for:



\- Albums.

\- Collections.

\- Tags.

\- Categories.

\- Custom descriptions.

\- User-defined organization rules in future versions.



\*\*Important:\*\*



Do not automatically rename, move, modify, or delete original media files.



Initially, organization should operate primarily on metadata and virtual collections.



Any future destructive or remote file-changing operation must require explicit user authorization.



\---



\## 10. Microsoft OneDrive Integration



Implement OneDrive integration using the official Microsoft Graph API and Microsoft identity platform.



\### OAuth authentication



Allow individual users to connect their own Microsoft account.



Implement:



\- Account connection.

\- OAuth authorization flow.

\- Secure access-token management.

\- Refresh-token handling where supported.

\- Connection status.

\- Account disconnection.

\- Permission error handling.



Use the minimum required permissions.



Do not request broad write permissions when read-only permissions are sufficient.



\### OneDrive account management



Support:



\- Connecting a OneDrive account.

\- Displaying account information.

\- Browsing accessible folders.

\- Selecting folders for indexing.

\- Saving selected folder configurations.

\- Viewing synchronization status.

\- Manually initiating synchronization.

\- Disconnecting the account.



\### Initial synchronization behavior



When the user selects folders, the application should:



1\. Scan the selected folders.

2\. Discover supported media files.

3\. Retrieve available metadata.

4\. Store metadata in SQLite.

5\. Avoid downloading entire files by default.

6\. Obtain thumbnails when available.

7\. Maintain references to the original OneDrive files.

8\. Record synchronization progress.

9\. Continue safely after interruptions.

10\. Avoid creating duplicate database records.



Use stable remote file identifiers rather than filenames alone.



Use paginated Microsoft Graph requests and incremental synchronization mechanisms, including delta queries where appropriate.



Respect API throttling and implement retry/backoff logic.



\### Storage strategy



\- Original media remains in OneDrive.

\- SQLite stores metadata and organization information.

\- A configurable local cache may store temporary thumbnails or previews.

\- Any cached files must be isolated by access permissions.

\- Avoid caching full-size private media unless necessary and explicitly configured.



\### Security requirements



\- Never expose OAuth tokens to the frontend unnecessarily.

\- Encrypt sensitive stored credentials.

\- Keep each user's OneDrive connection isolated.

\- Enforce authorization before accessing remote assets.

\- Handle token expiration and revoked permissions.

\- Provide a clear reauthentication flow.



\### Future organization support



Design the integration for future instructions such as:



\- Scan a specific folder.

\- Organize images by year.

\- Group videos by recording date.

\- Identify possible duplicates.

\- Create virtual albums.

\- Classify media by metadata.

\- Suggest file organization changes.



Do not implement automatic remote renaming, movement, or deletion in the initial version.



Ensure those operations can be added through a controlled, preview-and-approve workflow.



\### Missing credentials



If Microsoft application credentials are not available:



\- Implement the complete integration configuration.

\- Provide the connection interface.

\- Display a clear configuration-required state.

\- Document Microsoft Entra application registration.

\- Document redirect URI configuration.

\- Document required delegated permissions.

\- Do not create fake working connections.



\---



\## 11. Email Integration and Reminders



Implement a reliable email notification system.



\### Email configuration



Support SMTP configuration through secure environment variables.



Configuration should support:



\- SMTP host.

\- SMTP port.

\- Encryption settings.

\- Username.

\- Password or application-specific credential.

\- Sender address.

\- Sender display name.



Provide a test-email function for administrators.



Do not hardcode credentials.



\### Reminder types



Support automatic reminders for:



\- Upcoming calendar events.

\- Upcoming task deadlines.

\- Overdue tasks.

\- Project deadlines.



\### Reminder settings



Allow users to configure reminders such as:



\- At event time.

\- 15 minutes before.

\- 30 minutes before.

\- 1 hour before.

\- 1 day before.

\- 1 week before.

\- Custom reminder interval.



Users should be able to configure reminder preferences at both the user and individual event/task levels.



\### Reminder delivery



Implement a persistent reminder queue or database-backed scheduling mechanism.



Requirements:



\- Reminders survive server restarts.

\- Reminders are not accidentally sent multiple times.

\- Failed deliveries can be retried.

\- Delivery attempts are recorded.

\- Timezone and daylight-saving transitions are handled correctly.

\- Editing or deleting an event updates or cancels its pending reminders.

\- Recurring events generate appropriate reminders.

\- Overdue reminders are handled according to a documented policy.



Do not rely exclusively on in-memory timers.



\### Email templates



Create clean HTML emails and plain-text alternatives.



An event reminder should contain:



\- Event title.

\- Start date and time.

\- Description or short summary.

\- Location if available.

\- Link to the event in the application.



A task reminder should contain:



\- Task title.

\- Due date.

\- Priority.

\- Status.

\- Progress.

\- Link to the task.



\### Notification center



Provide an in-application notification center showing:



\- Unread notifications.

\- Read notifications.

\- Upcoming reminders.

\- Recent delivery-related information where appropriate.



Allow users to mark notifications as read.



Administrators should be able to review email delivery failures without exposing private message content unnecessarily.



\---



\## 12. Authentication, Authorization, and Multi-User Support



Security is a fundamental requirement.



Implement a production-grade authentication and authorization system.



\### User accounts



Support:



\- Initial administrator setup.

\- Administrator-created accounts.

\- Login.

\- Logout.

\- Password change.

\- Password reset.

\- Profile editing.

\- Account activation/deactivation.

\- Session management.



Public registration should be disabled by default.



The first administrator must be created through a secure bootstrap procedure.



Never ship the application with a known default administrator password.



\### User profiles



Each user should have:



\- Unique ID.

\- Display name.

\- Email.

\- Optional profile image.

\- Role.

\- Timezone.

\- Language preference.

\- Theme preference.

\- Notification preferences.

\- Account status.

\- Creation timestamp.

\- Last login timestamp.



\### Roles



Implement role-based access control (RBAC).



Initial roles:



\*\*Super Administrator\*\*



\- Full application administration.

\- User management.

\- Role management.

\- Application settings.

\- All explicitly permitted administrative operations.



\*\*Administrator\*\*



\- Manage users within the permitted scope.

\- Manage shared resources.

\- View relevant administrative activity.



\*\*Standard User\*\*



\- Manage their own events.

\- Manage their own tasks and projects.

\- Manage their own assets.

\- Configure personal integrations.



\*\*Read-Only User\*\*



\- View resources explicitly shared with them.

\- No modification permissions.



Build a permission system that can be extended without rewriting authorization logic.



\### Data isolation



\- Users must not automatically access each other's private data.

\- All data access must be checked on the server.

\- Shared resources require explicit permissions.

\- A user must not gain access by modifying an API request or guessing another resource ID.

\- Privileged operations must enforce authorization independently of UI visibility.



\### Multi-factor authentication



Implement MFA using an established, maintained library.



Minimum requirements:



\- TOTP authenticator applications.

\- QR-code enrollment.

\- Verification during enrollment.

\- One-time recovery codes.

\- Secure disabling/reset procedures.

\- Administrator policy to require MFA for privileged roles.



Store MFA secrets encrypted and recovery codes securely hashed.



\### Session security



\- Secure, HTTP-only cookies.

\- Appropriate SameSite and CSRF protection.

\- Session expiration.

\- Session revocation.

\- Protection against session fixation.

\- Rate limiting on login and sensitive endpoints.

\- Password hashing using Argon2id or another appropriate modern algorithm.

\- Secure account recovery.



Avoid implementing custom cryptographic primitives.



\### Audit logging



Record security-relevant activity, including:



\- Login successes and failures.

\- Password changes.

\- MFA enrollment or removal.

\- User creation and deactivation.

\- Role modifications.

\- Permission changes.

\- Integration connections and disconnections.

\- Significant resource modifications.



Audit records should include appropriate actor, action, target, timestamp, and outcome information.



Never store passwords, tokens, or other secrets in audit logs.



\---



\## 13. Database Design



Use SQLite for application metadata and persistence.



Enable foreign-key enforcement and configure SQLite appropriately for concurrent access.



Use WAL mode where suitable.



\### Suggested entities



Create normalized tables for:



\- Users

\- Profiles

\- Roles

\- Permissions

\- Role permissions

\- Sessions

\- MFA credentials

\- Recovery codes

\- Events

\- Event recurrence rules

\- Event exceptions

\- Event participants

\- Tasks

\- Task history

\- Projects

\- Project members

\- Tags

\- Tag associations

\- Assets

\- Asset metadata

\- Asset collections

\- Asset collection members

\- OneDrive connections

\- OneDrive folders

\- Synchronization jobs

\- Synchronization state

\- Notifications

\- Reminder schedules

\- Email delivery attempts

\- User preferences

\- Audit logs



Adjust the schema where justified and avoid unnecessary tables.



\### Database requirements



\- Versioned migrations.

\- Foreign keys.

\- Indexes for frequently queried fields.

\- Transactional updates for related changes.

\- Unique constraints to prevent duplicates.

\- Consistent timestamps.

\- Database backup support.

\- Documented restore procedure.



Store timestamps in UTC and convert them to the user's configured timezone for presentation and scheduling.



\### Database storage



Use a persistent database directory that is not exposed publicly by the web server.



In Docker, mount the database directory as a persistent volume.



Do not store the production database inside a temporary container filesystem.



\### Backups



Implement or document automated SQLite backups using a SQLite-safe online backup mechanism.



Do not rely on unsafe copying of an active database file.



Include a tested restore procedure.



\---



\## 14. Backend API



Create a clear, maintainable API architecture.



Use REST endpoints unless there is a compelling reason for another approach.



\### Suggested API groups



\- `/api/auth`

\- `/api/users`

\- `/api/roles`

\- `/api/profile`

\- `/api/dashboard`

\- `/api/events`

\- `/api/tasks`

\- `/api/projects`

\- `/api/assets`

\- `/api/collections`

\- `/api/integrations/onedrive`

\- `/api/notifications`

\- `/api/reminders`

\- `/api/admin`

\- `/api/health`



Use suitable HTTP methods and status codes.



\### API requirements



\- Input validation.

\- Authentication.

\- Resource-level authorization.

\- Pagination.

\- Filtering.

\- Sorting.

\- Structured error responses.

\- Consistent date serialization.

\- Database error handling.

\- Request logging.

\- Rate limiting where appropriate.



Provide an API specification using OpenAPI or another suitable format.



Do not expose internal stack traces or sensitive information to clients in production.



\---



\## 15. Background Processing



The system requires background processing for:



\- Reminder scheduling.

\- Email dispatch.

\- OneDrive synchronization.

\- Metadata indexing.

\- Retry processing.

\- Maintenance tasks.



Implement a small but reliable job-processing subsystem appropriate for a single-VPS deployment.



\### Requirements



\- Persist job state in SQLite.

\- Recover unfinished jobs after application restarts.

\- Avoid duplicate processing.

\- Support retries with backoff.

\- Record failures.

\- Allow controlled manual retry.

\- Limit concurrent external API requests.

\- Provide basic job status visibility.



Design the worker process so that a future move to a dedicated queue system is possible.



Avoid requiring Redis for the initial deployment.



Prevent multiple application instances from accidentally processing the same job concurrently.



\---



\## 16. Activity History and Reporting



Create an activity center to display meaningful application changes.



\### Track



\- Event creation and modification.

\- Task creation and completion.

\- Task progress changes.

\- Project updates.

\- Asset metadata changes.

\- Synchronization operations.



\### Activity interface



\- Chronological activity feed.

\- Filters by type.

\- Filters by date.

\- Filters by user, where authorized.

\- Direct links to affected resources.

\- Pagination.



Distinguish between:



1\. User-visible activity history.

2\. Security and administrative audit logs.



Enforce suitable visibility rules.



\---



\## 17. Search



Implement useful search functionality throughout the application.



\### Global search



Provide a global search field covering resources the current user is authorized to access.



Initially search:



\- Event titles and descriptions.

\- Task titles and descriptions.

\- Project names.

\- Asset filenames.

\- Asset tags.

\- Asset descriptions.



\### Search behavior



\- Fast responses.

\- Paginated results.

\- Resource-type filters.

\- Consistent ranking.

\- Navigation directly to results.



Use appropriate SQLite indexing, including FTS5 where justified.



Do not expose results from another user's private resources.



\---



\## 18. Settings



Provide a settings area for:



\### Personal settings



\- Profile information.

\- Password.

\- MFA.

\- Language.

\- Timezone.

\- Theme.

\- Notification preferences.

\- Default reminder intervals.

\- Connected cloud accounts.



\### Administrative settings



\- User management.

\- Role and permission management.

\- SMTP configuration status.

\- Test email.

\- Background job status.

\- System health.

\- Database backup status.

\- Application information.

\- Audit logs.



Sensitive settings must be available only to appropriately authorized users.



\---



\## 19. Security and Privacy



Apply production security practices throughout the project.



Requirements include:



\- HTTPS in production.

\- Secure authentication.

\- Password hashing.

\- Encrypted sensitive integration credentials.

\- Authorization on every protected operation.

\- CSRF protection where applicable.

\- XSS mitigation.

\- Protection against SQL injection.

\- Request validation.

\- Rate limiting.

\- Secure HTTP headers.

\- Safe error handling.

\- Secure logging.

\- Dependency vulnerability checks.

\- Appropriate file upload restrictions if uploads are implemented.

\- Protection against unauthorized access to cached media.

\- No production secrets committed to source control.



Use environment variables or an appropriate secrets mechanism for sensitive configuration.



Provide `.env.example` without actual secrets.



Clearly document required production secrets, including the encryption key used to protect stored OAuth credentials and MFA secrets.



Do not log secret values.



\---



\## 20. Deployment Requirements



The application must be deployable to a standard Linux VPS.



Target a recent Ubuntu LTS release, while remaining compatible with other common Linux distributions.



\### Docker deployment



Provide:



\- Dockerfile.

\- `docker-compose.yml`.

\- Production configuration.

\- Persistent data volumes.

\- Health checks.

\- Restart policies.

\- Reverse proxy configuration.

\- HTTPS support.

\- Environment variable examples.



Use multi-stage Docker builds where appropriate.



Avoid running application processes as root unnecessarily.



\### Production behavior



\- Build optimized production assets.

\- Run the application using production settings.

\- Persist SQLite data.

\- Persist relevant cached assets.

\- Restart automatically after failures.

\- Support graceful shutdown.

\- Shut down background workers cleanly.

\- Preserve queued jobs during restarts.

\- Support application upgrades with database migrations.



\### HTTPS



Provide straightforward HTTPS deployment using Caddy or an equivalent reverse proxy.



Document domain configuration, firewall ports, and certificate provisioning.



\### Deployment documentation



Explain:



1\. How to clone or copy the project to a VPS.

2\. How to configure environment variables.

3\. How to configure the domain.

4\. How to build containers.

5\. How to start the application.

6\. How to initialize the first administrator.

7\. How to run migrations.

8\. How to view logs.

9\. How to back up the database.

10\. How to restore from backup.

11\. How to update the application safely.

12\. How to configure SMTP.

13\. How to configure OneDrive OAuth.



Also support straightforward local development without Docker.



\---



\## 21. Local Development



Provide standard commands for:



\- Installing dependencies.

\- Starting the development server.

\- Running database migrations.

\- Starting the background worker.

\- Running tests.

\- Building production assets.

\- Starting the production application.



Prefer straightforward commands such as:



```bash

npm install

npm run dev

npm run build

npm run start

npm run test

```



Additional commands are acceptable where required.



Ensure development setup does not require real OneDrive or email credentials.



\---



\## 22. Testing and Quality Assurance



Implement automated tests for critical functionality.



\### Unit tests



Include tests for:



\- Date/time handling.

\- Recurring-event calculations.

\- Task progress logic.

\- Reminder scheduling.

\- Permission checks.

\- Validation.

\- Metadata parsing.



\### Integration tests



Include tests for:



\- Authentication.

\- User management.

\- CRUD operations.

\- Role authorization.

\- Data isolation.

\- Database persistence.

\- Reminder job creation.

\- Email scheduling.

\- OneDrive API behavior using mocks.

\- Background job recovery.



\### End-to-end tests



Test representative user workflows:



1\. Administrator initializes the application.

2\. User logs in.

3\. User creates a calendar event.

4\. User edits and deletes an event.

5\. User creates and completes a task.

6\. User creates a project.

7\. User assigns tasks to the project.

8\. Dashboard statistics update.

9\. User configures a reminder.

10\. User sees an in-app notification.

11\. User configures MFA.

12\. An unauthorized user is denied access to another user's private resource.

13\. OneDrive setup correctly handles missing credentials.

14\. Application remains functional after restart.



Use appropriate mocks for external services.



\### Final validation



Before completing the task:



\- Run linting.

\- Run type checking.

\- Run tests.

\- Run the production build.

\- Verify database migrations.

\- Check application startup.

\- Verify critical API endpoints.

\- Confirm the mobile interface is usable.

\- Check that no secret keys are committed.

\- Review dependency security.

\- Correct discovered failures.



Do not declare tests successful unless they were actually executed successfully.



\---



\## 23. Documentation



Create a useful README containing:



\- Project overview.

\- Screenshots or interface descriptions where appropriate.

\- Technology stack.

\- Architecture overview.

\- Directory structure.

\- Local setup instructions.

\- Environment configuration.

\- Database migration commands.

\- Testing instructions.

\- VPS deployment guide.

\- OneDrive setup.

\- SMTP setup.

\- Backup and restoration.

\- Troubleshooting.

\- Known limitations.



Include a short architectural document describing:



\- Main modules.

\- Data flow.

\- Authentication and authorization strategy.

\- Background job processing.

\- OneDrive synchronization strategy.

\- Future extension points.



\---



\## 24. Extensibility



Design the application so that future features can be added without substantial rewrites.



Potential future modules include:



\- Google Calendar integration.

\- Outlook Calendar integration.

\- Google Drive integration.

\- Local NAS storage.

\- Automatic duplicate image detection.

\- Video metadata extraction.

\- Image similarity search.

\- AI-assisted asset classification.

\- Advanced media organization rules.

\- File organization proposals requiring approval.

\- Document management.

\- Custom dashboards.

\- Push notifications.

\- Mobile PWA functionality.



Do not implement all these future features now.



However, avoid architectural decisions that would unnecessarily prevent them.



Create clear integration boundaries for cloud providers, media metadata extraction, notifications, and background processing.



\---



\## 25. Implementation Priority



Implement in the following sequence.



\### Phase 1 — Foundation



\- Project initialization.

\- Application architecture.

\- SQLite integration.

\- Database migrations.

\- Authentication.

\- User management.

\- Roles and permissions.

\- MFA.

\- Responsive application shell.

\- Profile and settings screens.



\### Phase 2 — Productivity



\- Calendar CRUD.

\- Calendar views.

\- Recurring events.

\- Tasks.

\- Task progress.

\- Projects.

\- Dashboard statistics.

\- Activity history.



\### Phase 3 — Notifications



\- SMTP integration.

\- Reminder configuration.

\- Persistent scheduler.

\- Background worker.

\- Email delivery.

\- Notification center.



\### Phase 4 — Asset Management



\- Asset metadata database.

\- Asset browsing interface.

\- Collections.

\- Tag management.

\- Search and filters.

\- Image/video previews.



\### Phase 5 — OneDrive



\- Microsoft OAuth integration.

\- Account connection.

\- Remote folder browsing.

\- Folder selection.

\- Metadata synchronization.

\- Synchronization status.

\- Incremental updates.

\- Error recovery.



\### Phase 6 — Production Readiness



\- Automated tests.

\- Security review.

\- Docker configuration.

\- HTTPS reverse proxy.

\- Backups.

\- Deployment documentation.

\- Production build verification.



\*\*Continue implementing through all six phases.\*\*



Do not treat an incomplete phase as completed.



If an external service cannot be exercised because credentials are missing, complete its implementation, use mocks to test it, and document exactly what remains unverified.



\---



\## 26. Definition of Done



The project is complete when the following conditions are satisfied:



\- \[ ] The application starts locally.

\- \[ ] The production build succeeds.

\- \[ ] SQLite persists application data.

\- \[ ] The initial administrator can be created securely.

\- \[ ] Users can authenticate and manage profiles.

\- \[ ] Roles and permissions are enforced.

\- \[ ] MFA enrollment and verification function.

\- \[ ] Users can create, edit, view, and delete events.

\- \[ ] Calendar views function.

\- \[ ] Recurring events are handled correctly.

\- \[ ] Users can create, edit, view, and delete tasks.

\- \[ ] Task progress and status are functional.

\- \[ ] Projects can be created and associated with tasks.

\- \[ ] Dashboard statistics reflect real database data.

\- \[ ] Reminder jobs persist across restarts.

\- \[ ] Email notifications work when SMTP is configured.

\- \[ ] Assets can be indexed and browsed.

\- \[ ] Asset metadata can be edited.

\- \[ ] OneDrive connection and folder selection are implemented.

\- \[ ] OneDrive metadata synchronization is implemented.

\- \[ ] OneDrive features degrade gracefully without credentials.

\- \[ ] User data isolation is enforced.

\- \[ ] The interface works on desktop and mobile.

\- \[ ] Docker deployment configuration is included.

\- \[ ] Production database storage is persistent.

\- \[ ] Backup and restoration are documented.

\- \[ ] Automated tests cover critical workflows.

\- \[ ] Deployment documentation is complete.



All major screens must be connected to actual backend functionality.



Do not substitute static example records, mock dashboards, or nonfunctional buttons for completed features.



\---



\## 27. Final Agent Instructions



Start by inspecting the current directory and development environment.



Then implement the complete application.



Work autonomously, making practical engineering decisions.



Maintain clear code organization and appropriate documentation.



Prefer simple, robust solutions to excessive abstraction.



Use existing mature libraries for security-sensitive or technically complex functionality.



Test each major module before moving to the next.



Fix problems rather than merely describing them.



Do not claim deployment readiness without successfully building and validating the production configuration.



At the end, provide:



1\. A concise architectural summary.

2\. A description of implemented modules.

3\. The final directory structure.

4\. Commands to start the application locally.

5\. Commands to deploy it with Docker.

6\. Instructions for initial administrator creation.

7\. Required configuration variables.

8\. Test results.

9\. Features that depend on external credentials.

10\. Any incomplete features or known limitations, stated explicitly.



\*\*Your final deliverable must be a working, maintainable, production-deployable full-stack application, not just a design or development plan.\*\*




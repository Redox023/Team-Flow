const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const { sendSuccess, AppError } = require('../utils/response');

const formatMembers = (members) => {
  return members.map((m) => ({
    userId: m.userId._id ? m.userId._id.toString() : m.userId.toString(),
    role: m.role,
    user: m.userId._id ? {
      id: m.userId._id.toString(),
      fullName: m.userId.fullName,
      email: m.userId.email,
    } : null,
  }));
};

const getProjects = async (req, res, next) => {
  try {
    const projects = await Project.find({ 'members.userId': req.user.id })
      .populate('members.userId', 'fullName email')
      .sort({ createdAt: -1 });

    const taskCounts = await Task.aggregate([
      { $match: { projectId: { $in: projects.map((p) => p._id) } } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    taskCounts.forEach((t) => { countMap[t._id.toString()] = t.count; });

    const enriched = projects.map((p) => {
      const obj = p.toObject();
      const membership = obj.members.find((m) => m.userId._id.toString() === req.user.id.toString());
      return {
        ...obj,
        id: obj._id,
        taskCount: countMap[obj._id.toString()] || 0,
        myRole: membership?.role,
        members: formatMembers(obj.members),
      };
    });

    return sendSuccess(res, { projects: enriched }, 'Projects fetched');
  } catch (err) {
    next(err);
  }
};

const getProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).populate('members.userId', 'fullName email');
    if (!project) throw new AppError('Project not found', 404);

    const membership = project.members.find((m) => m.userId._id.toString() === req.user.id.toString());
    if (!membership) throw new AppError('You are not a member of this project', 403);

    const taskCount = await Task.countDocuments({ projectId: project._id });
    const obj = project.toObject();

    return sendSuccess(
      res,
      { project: { ...obj, id: obj._id, taskCount, myRole: membership.role, members: formatMembers(obj.members) } },
      'Project fetched'
    );
  } catch (err) {
    next(err);
  }
};

const createProject = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const project = await Project.create({
      name,
      description,
      members: [{ userId: req.user.id, role: 'ADMIN' }],
    });

    await project.populate('members.userId', 'fullName email');
    const obj = project.toObject();

    return sendSuccess(res, { project: { ...obj, id: obj._id, myRole: 'ADMIN', members: formatMembers(obj.members) } }, 'Project created', 201);
  } catch (err) {
    next(err);
  }
};

const updateMembers = async (req, res, next) => {
  try {
    const { action, userId, role } = req.body;
    const projectId = req.params.id;

    const project = await Project.findById(projectId);
    if (!project) throw new AppError('Project not found', 404);

    const requesterMembership = project.members.find((m) => m.userId.toString() === req.user.id.toString());
    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      throw new AppError('Only admins can manage project members', 403);
    }

    if (action === 'add') {
      const targetUser = await User.findById(userId);
      if (!targetUser) throw new AppError('User not found', 404);

      const existingIdx = project.members.findIndex((m) => m.userId.toString() === userId);
      if (existingIdx >= 0) {
        project.members[existingIdx].role = role || 'MEMBER';
      } else {
        project.members.push({ userId, role: role || 'MEMBER' });
      }
      await project.save();
      await project.populate('members.userId', 'fullName email');

      const obj = project.toObject();
      const formattedMembers = formatMembers(obj.members);
      const addedMember = formattedMembers.find((m) => m.userId === userId);
      return sendSuccess(res, { member: addedMember }, 'Member added');
    }

    if (action === 'remove') {
      const targetMembership = project.members.find((m) => m.userId.toString() === userId);
      if (!targetMembership) throw new AppError('User is not a member of this project', 404);

      if (targetMembership.role === 'ADMIN') {
        const adminCount = project.members.filter((m) => m.role === 'ADMIN').length;
        if (adminCount <= 1) throw new AppError('Cannot remove the last admin from a project', 400);
      }

      project.members = project.members.filter((m) => m.userId.toString() !== userId);
      await project.save();
      return sendSuccess(res, {}, 'Member removed');
    }

    throw new AppError('Invalid action. Use "add" or "remove"', 400);
  } catch (err) {
    next(err);
  }
};

const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) throw new AppError('Project not found', 404);

    const membership = project.members.find((m) => m.userId.toString() === req.user.id.toString());
    if (!membership || membership.role !== 'ADMIN') {
      throw new AppError('Only admins can delete projects', 403);
    }

    await Task.deleteMany({ projectId: project._id });
    await project.deleteOne();
    return sendSuccess(res, {}, 'Project deleted');
  } catch (err) {
    next(err);
  }
};

module.exports = { getProjects, getProject, createProject, updateMembers, deleteProject };
